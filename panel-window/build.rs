/// 把图标嵌进 exe（任务栏/Alt+Tab 用的是 exe 里的图标资源，不是页面里那张图）。
///
/// 图标直接取上游 dsh-x 的 assets/dsh.ico —— 界面本身就是它的，图标跟着一致才不违和。
/// dsh-x 还没拉下来（没跑过 update.bat）时跳过：没有图标只是难看一点，不影响构建。
fn main() {
    println!("cargo:rerun-if-changed=../dsh-x/assets/dsh.ico");
    #[cfg(windows)]
    {
        let icon = std::path::Path::new("../dsh-x/assets/dsh.ico");
        if !icon.exists() {
            println!("cargo:warning=未找到 ../dsh-x/assets/dsh.ico（先跑 update-panel.ps1 拉取界面），本次不嵌入图标");
            return;
        }
        let mut res = winresource::WindowsResource::new();
        res.set_icon("../dsh-x/assets/dsh.ico");
        // 这些字段不只是好看：杀软/信誉服务看厂商与原始文件名，一片空白的未签名 exe
        // 更容易被启发式拦下来。
        res.set("ProductName", "DSH 面板");
        res.set("FileDescription", "DSH 管理面板窗口");
        res.set("OriginalFilename", "panel-window.exe");
        res.set("InternalName", "panel-window");
        res.set("FileVersion", env!("CARGO_PKG_VERSION"));
        res.set("ProductVersion", env!("CARGO_PKG_VERSION"));
        if let Err(error) = res.compile() {
            // 嵌图标失败不该让整个构建失败：窗口照样能开，只是图标是默认的
            println!("cargo:warning=嵌入图标失败：{error}");
        }
    }
}
