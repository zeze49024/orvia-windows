use std::{collections::HashMap, sync::Mutex, time::Instant};
use std::{
    fs,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::State;
use tauri_plugin_dialog::DialogExt;
#[derive(Default)]
pub struct PdfGrants(Mutex<HashMap<String, (PathBuf, String, Instant)>>);
impl PdfGrants {
    fn issue(&self, path: PathBuf, label: String) -> Result<String, String> {
        let mut grants = self.0.lock().map_err(|_| "PDF_GRANT")?;
        grants.retain(|_, g| g.2.elapsed() < Duration::from_secs(300));
        if grants.len() >= 16 {
            return Err("PDF_GRANT_LIMIT".into());
        }
        let token = uuid::Uuid::new_v4().to_string();
        grants.insert(token.clone(), (path, label, Instant::now()));
        Ok(token)
    }
    fn consume(&self, token: &str, label: &str) -> Result<PathBuf, String> {
        let grant = self
            .0
            .lock()
            .map_err(|_| "PDF_GRANT")?
            .remove(token)
            .ok_or("PDF_NOT_AUTHORIZED")?;
        if grant.1 != label || grant.2.elapsed() > Duration::from_secs(300) {
            return Err("PDF_NOT_AUTHORIZED".into());
        }
        Ok(grant.0)
    }
}
#[tauri::command]
pub async fn pick_pdf_target(
    window: tauri::WebviewWindow,
    name: String,
    grants: State<'_, PdfGrants>,
) -> Result<Option<String>, String> {
    let filename: String = name
        .chars()
        .take(140)
        .map(|c| {
            if c.is_control() || "\\/:*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .dialog()
        .file()
        .set_parent(&window)
        .set_file_name(filename)
        .add_filter("PDF", &["pdf"])
        .save_file(move |file| {
            let _ = tx.send(file);
        });
    let file = tauri::async_runtime::spawn_blocking(move || {
        rx.recv().map_err(|_| "PDF_DIALOG".to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    let Some(file) = file else { return Ok(None) };
    let path = file.into_path().map_err(|_| "PDF_PATH")?;
    let parent = path
        .parent()
        .ok_or("PDF_PATH")?
        .canonicalize()
        .map_err(|_| "PDF_PATH")?;
    if std::fs::symlink_metadata(&path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("PDF_SYMLINK".into());
    }
    let chosen = parent.join(path.file_name().ok_or("PDF_PATH")?);
    grants.issue(chosen, window.label().to_owned()).map(Some)
}
#[tauri::command]
pub fn revoke_pdf_target(window: tauri::WebviewWindow, token: String, grants: State<PdfGrants>) {
    let _ = grants.consume(&token, window.label());
}
#[tauri::command]
pub async fn export_pdf(
    window: tauri::WebviewWindow,
    token: String,
    grants: State<'_, PdfGrants>,
) -> Result<(), String> {
    let target = grants.consume(&token, window.label())?;

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

#[cfg(test)]
mod grant_tests {
    use super::*;
    #[test]
    fn grants_are_single_use_and_window_bound() {
        let g = PdfGrants::default();
        assert!(g.consume("missing", "main").is_err());
        let token = g
            .issue(PathBuf::from("C:/chosen.pdf"), "main".into())
            .unwrap();
        assert!(g.consume(&token, "other").is_err());
        assert!(g.consume(&token, "main").is_err());
        let token = g
            .issue(PathBuf::from("C:/chosen.pdf"), "main".into())
            .unwrap();
        assert_eq!(
            g.consume(&token, "main").unwrap(),
            PathBuf::from("C:/chosen.pdf")
        );
        assert!(g.consume(&token, "main").is_err());
    }
}
