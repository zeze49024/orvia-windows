use std::{
    fs,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
#[tauri::command]
pub async fn export_pdf(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !target.is_absolute()
        || target
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| !e.eq_ignore_ascii_case("pdf"))
            .unwrap_or(true)
        || !target.parent().map(|p| p.is_dir()).unwrap_or(false)
    {
        return Err("PDF_PATH".into());
    }
    let temp = target.with_file_name(format!(
        ".orvia-pdf-{}-{}.pdf",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    #[cfg(windows)]
    {
        use webview2_com::{
            Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment6, ICoreWebView2_7},
            PrintToPdfCompletedHandler,
        };
        use windows::core::{Interface, HSTRING};
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let output = temp.clone();
        window
            .with_webview(move |view| {
                let failed = tx.clone();
                let start = (|| -> windows::core::Result<()> {
                    unsafe {
                        let webview = view
                            .controller()
                            .CoreWebView2()?
                            .cast::<ICoreWebView2_7>()?;
                        let env = view.environment().cast::<ICoreWebView2Environment6>()?;
                        let settings = env.CreatePrintSettings()?;
                        settings.SetPageWidth(8.2677)?;
                        settings.SetPageHeight(11.6929)?;
                        settings.SetMarginTop(0.6)?;
                        settings.SetMarginBottom(0.6)?;
                        settings.SetMarginLeft(0.6)?;
                        settings.SetMarginRight(0.6)?;
                        settings.SetShouldPrintBackgrounds(true)?;
                        settings.SetShouldPrintHeaderAndFooter(false)?;
                        let callback =
                            PrintToPdfCompletedHandler::create(Box::new(move |result, success| {
                                let value = if result.is_ok() && success {
                                    Ok(())
                                } else {
                                    Err("PDF_PRINT_FAILED".into())
                                };
                                let _ = tx.send(value);
                                Ok(())
                            }));
                        webview.PrintToPdf(
                            &HSTRING::from(output.as_os_str()),
                            &settings,
                            &callback,
                        )?;
                        Ok(())
                    }
                })();
                if let Err(error) = start {
                    let _ = failed.send(Err(format!("PDF_UNAVAILABLE: {error}")));
                }
            })
            .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            let result = (|| {
                rx.recv_timeout(Duration::from_secs(90))
                    .map_err(|_| "PDF_TIMEOUT".to_string())??;
                let bytes = fs::read(&temp).map_err(|_| "PDF_READ")?;
                if !bytes.starts_with(b"%PDF-") {
                    return Err("PDF_INVALID".into());
                }
                fs::rename(&temp, &target).map_err(|_| "PDF_WRITE".to_string())?;
                Ok(())
            })();
            if result.is_err() {
                let _ = fs::remove_file(&temp);
            }
            result
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, temp);
        Err("PDF_WINDOWS_ONLY".into())
    }
}
