#![cfg(windows)]
#![windows_subsystem = "windows"]

//! DSH 管理面板的原生窗口壳。
//!
//! 为什么不是浏览器的「应用模式窗口」：那个窗口顶着一条系统标题栏，和界面本身不是一个
//! 风格；而且 Edge 已经开着的时候 `--window-size` 会被忽略，尺寸完全不受我们控制。
//! 上游 DSH-X 的做法是自己建一个无边框窗口 + WebView2，标题栏、最小化/最大化/关闭、
//! 拖动都由页面画（页面的 `?window=1` 模式就是干这个的）。这里用同一套库
//! （tao + wry）做同一件事，尺寸、DPI、观感才对得上。
//!
//! 与上游 launcher 的分工不同：**这个进程不拉 node**。面板服务由 start-panel.bat
//! （start-panel.ps1 → node panel-server.mjs）拉起，node 再把自己这个壳拉起来并给出
//! URL——这样控制台日志仍然留在 node 那边（上游的壳会把 node 的 stdout 吞掉）。
//!
//! 参数：
//!   --url <url>          要加载的页面（带 ?window=1）
//!   --parent-pid <pid>   父进程（node）；它一退，窗口跟着退
//!   --width/--height     逻辑像素尺寸，默认 1100x760（与 DSH-X 一致）
//!   --title <text>       窗口标题（只在任务栏/Alt+Tab 里可见，标题栏是页面画的）
//!
//! 行为：
//!   ✕ / Alt+F4 只关窗口，**不**停掉面板与 dsh（面板还在控制台里跑）；再双击一次
//!   start-panel.bat，面板会通过 /api/window 让新壳把窗口再开出来（或把活着的那个叫到前面）。

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

use tao::dpi::{LogicalSize, PhysicalPosition};
use tao::event::{Event, StartCause, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::WindowBuilder;
use wry::{WebContext, WebViewBuilder};

/// 与 DSH-X 的窗口同一套尺寸（逻辑像素）——比例对不对齐就看这里。
const DEFAULT_W: f64 = 1100.0;
const DEFAULT_H: f64 = 760.0;
const MIN_W: f64 = 720.0;
const MIN_H: f64 = 520.0;
/// 问面板「要不要把窗口叫出来」的间隔（面板在收到重复启动时置位）。
const SHOW_POLL: Duration = Duration::from_millis(1200);
const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);

#[derive(Debug)]
enum UserEvent {
    /// 面板要求把窗口叫到前面（重复双击 start-panel.bat）
    Show,
    /// 父进程（node）退出了：面板已经不在，窗口没有存在的意义
    ParentGone,
    Minimize,
    ToggleMaximize,
    Drag,
    Close,
}

/// `--name value` 形式的参数解析；缺省返回 None。
fn arg(name: &str) -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(item) = args.next() {
        if item == name {
            return args.next();
        }
        if let Some(rest) = item.strip_prefix(&format!("{name}=")) {
            return Some(rest.to_string());
        }
    }
    None
}

fn arg_f64(name: &str, fallback: f64) -> f64 {
    arg(name)
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| *value > 200.0)
        .unwrap_or(fallback)
}

/// 极简 HTTP GET（只问本机面板一个短路径），避免为这一件事引入 http 库。
fn http_get(addr: &str, path: &str) -> Option<String> {
    let socket: SocketAddr = addr.parse().ok()?;
    let mut stream = TcpStream::connect_timeout(&socket, PROBE_TIMEOUT).ok()?;
    stream.set_read_timeout(Some(PROBE_TIMEOUT)).ok()?;
    stream.set_write_timeout(Some(PROBE_TIMEOUT)).ok()?;
    stream
        .write_all(format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n").as_bytes())
        .ok()?;
    let mut raw = String::new();
    stream.read_to_string(&mut raw).ok()?;
    Some(
        raw.split_once("\r\n\r\n")
            .map(|(_, body)| body)
            .unwrap_or_default()
            .trim()
            .to_string(),
    )
}

/// 从 URL 里取出「主机:端口」，给上面那个极简 GET 用。
fn url_authority(url: &str) -> Option<String> {
    let rest = url.strip_prefix("http://")?;
    let authority = rest.split(['/', '?']).next()?;
    if authority.is_empty() {
        return None;
    }
    Some(authority.to_string())
}

fn main() {
    let url = arg("--url").unwrap_or_else(|| "http://127.0.0.1:3780/?window=1".to_string());
    let title = arg("--title").unwrap_or_else(|| "DSH 面板".to_string());
    let width = arg_f64("--width", DEFAULT_W);
    let height = arg_f64("--height", DEFAULT_H);
    let parent_pid = arg("--parent-pid").and_then(|value| value.parse::<u32>().ok());

    let mut builder = EventLoopBuilder::<UserEvent>::with_user_event();
    let event_loop = builder.build();
    let proxy = event_loop.create_proxy();

    // 无边框窗口拿不到系统的默认摆位，首次出现自己摆到主屏正中（与 DSH-X 一致）
    let centered = event_loop.primary_monitor().map(|monitor| {
        let screen = monitor.size();
        let area = LogicalSize::new(width, height).to_physical::<u32>(monitor.scale_factor());
        PhysicalPosition::new(
            monitor.position().x + (screen.width as i32 - area.width as i32) / 2,
            monitor.position().y + (screen.height as i32 - area.height as i32) / 2,
        )
    });

    let mut window_builder = WindowBuilder::new()
        .with_title(&title)
        // 不要原生标题栏：图标、标题、最小化/最大化/关闭都由页面自己画，风格才统一
        .with_decorations(false)
        .with_inner_size(LogicalSize::new(width, height))
        .with_min_inner_size(LogicalSize::new(MIN_W, MIN_H));
    if let Some(position) = centered {
        window_builder = window_builder.with_position(position);
    }
    let window = match window_builder.build(&event_loop) {
        Ok(window) => window,
        Err(error) => {
            eprintln!("窗口创建失败：{error}");
            std::process::exit(1);
        }
    };

    // WebView2 的数据目录放在面板自己的目录下（与 DSH-X 的 %APPDATA%\DSH\webview 同理）
    let data_dir: PathBuf = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("DeepSeekHarness")
        .join("panel")
        .join("webview");
    let _ = std::fs::create_dir_all(&data_dir);
    let mut context = WebContext::new(Some(data_dir));

    // 页面的窗口操作走 IPC 转成事件；窗口本身留在事件循环里操作
    let ipc_proxy = proxy.clone();
    let webview = match WebViewBuilder::new_with_web_context(&mut context)
        // 先 about:blank，导航留到事件循环跑起来之后：在 run 之前导航，WebView2 收下了
        // 却不会真正加载（上游 launcher 在错误页上实测过，是同一个坑）
        .with_url("about:blank")
        .with_ipc_handler(move |request| {
            let event = match request.body().as_str() {
                "minimize" => UserEvent::Minimize,
                "maximize" => UserEvent::ToggleMaximize,
                "close" => UserEvent::Close,
                "drag" => UserEvent::Drag,
                _ => return,
            };
            let _ = ipc_proxy.send_event(event);
        })
        // 页面里的外部链接（Star、运行地址、更新日志）交给系统浏览器；就地导航会把窗口
        // 连自定义标题栏一起导走，所以只放行面板自己
        .with_new_window_req_handler(|url, _features| {
            let _ = open_in_browser(&url);
            wry::NewWindowResponse::Deny
        })
        .with_navigation_handler({
            let allowed = url.clone();
            move |target| {
                if target == "about:blank" || target.starts_with(&allowed) {
                    return true;
                }
                let _ = open_in_browser(&target);
                false
            }
        })
        .build(&window)
    {
        Ok(webview) => webview,
        Err(error) => {
            eprintln!("WebView2 初始化失败：{error}");
            std::process::exit(1);
        }
    };

    // 父进程（node）一退，窗口跟着退——否则关掉控制台后会留一个连不上后端的死窗口
    if let Some(pid) = parent_pid {
        let proxy = proxy.clone();
        thread::spawn(move || {
            use windows_sys::Win32::Foundation::CloseHandle;
            use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject, INFINITE};
            /// SYNCHRONIZE：只申请「等这个进程退出」的权限。windows-sys 没把它放在
            /// Win32::Foundation 里导出，值就是 Win32 头文件里的 0x00100000。
            const SYNCHRONIZE: u32 = 0x0010_0000;
            unsafe {
                let handle = OpenProcess(SYNCHRONIZE, 0, pid);
                if handle.is_null() {
                    return;
                }
                WaitForSingleObject(handle, INFINITE);
                CloseHandle(handle);
            }
            let _ = proxy.send_event(UserEvent::ParentGone);
        });
    }

    // 面板在收到「重复双击」时置位 show：把窗口从最小化/背后叫回来
    if let Some(authority) = url_authority(&url) {
        let proxy = proxy.clone();
        thread::spawn(move || loop {
            let show = http_get(&authority, "/api/window")
                .map(|text| text.lines().any(|line| line.trim() == "show=1"))
                .unwrap_or(false);
            if show && proxy.send_event(UserEvent::Show).is_err() {
                break;
            }
            thread::sleep(SHOW_POLL);
        });
    }

    let mut navigated = false;
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if !navigated {
            if let Event::NewEvents(StartCause::Init) = event {
                navigated = true;
                let _ = webview.load_url(&url);
            }
        }
        match event {
            Event::UserEvent(UserEvent::Minimize) => window.set_minimized(true),
            Event::UserEvent(UserEvent::ToggleMaximize) => {
                window.set_maximized(!window.is_maximized());
            }
            Event::UserEvent(UserEvent::Drag) => {
                let _ = window.drag_window();
            }
            // 关窗口只是关窗口：面板与 dsh 仍在控制台里跑着，再双击 start-panel.bat 就能
            // 把窗口叫回来（面板通过 /api/window 让我们重新开一个或叫回这一个）
            Event::UserEvent(UserEvent::Close) => *control_flow = ControlFlow::Exit,
            Event::UserEvent(UserEvent::ParentGone) => *control_flow = ControlFlow::Exit,
            Event::UserEvent(UserEvent::Show) => {
                // 被 ─ 收到任务栏的窗口，光 set_visible + set_focus 拉不回来
                window.set_minimized(false);
                window.set_visible(true);
                window.set_focus();
            }
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                *control_flow = ControlFlow::Exit;
            }
            Event::WindowEvent { event: WindowEvent::Destroyed, .. } => {
                *control_flow = ControlFlow::Exit;
            }
            _ => {}
        }
    });
}

/// 用系统默认程序打开链接。
///
/// 不用 `cmd /c start`：cmd 会把 URL 再解析一遍，里面的 `&` 就是语句分隔符，页面上任何
/// 一个链接被构造成 `http://127.0.0.1:1/?&calc` 就成了任意命令执行。ShellExecuteW 中间
/// 没有 shell，参数按原样传。
fn open_in_browser(url: &str) -> Result<(), ()> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let verb: Vec<u16> = "open\0".encode_utf16().collect();
    let file: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        );
    }
    Ok(())
}
