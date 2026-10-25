import { closeHistory } from "@tiptap/pm/history";
import { useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Image, Settings2 } from "lucide-react";
import { LocalImage } from "./local-image";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { imageTitle, imageWidth } from "@/core/image-options";
import { store } from "@/core/storage";
import { translator } from "@/i18n";

export function AssetNode({
  node,
  updateAttributes,
  selected,
  editor,
}: NodeViewProps) {
  const t = translator(store.data.settings.locale);
  const [open, setOpen] = useState(false),
    [preview, setPreview] = useState(false);
  const [alt, setAlt] = useState(""),
    [width, setWidth] = useState(100);
  return (
    <NodeViewWrapper
      className={`editor-image${selected ? " image-selected" : ""}`}
      contentEditable={false}
      style={{ width: `${imageWidth(node.attrs.title)}%` }}
    >
      <LocalImage src={node.attrs.src} alt={node.attrs.alt} />
      <div className="image-actions">
        <Button
          variant="outline"
          size="sm"
          aria-label={t("imagePreview")}
          onClick={() => setPreview(true)}
        >
          <Image size={15} />
          {t("imagePreview")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label={t("imageOptions")}
          onClick={() => {
            setAlt(node.attrs.alt ?? "");
            setWidth(imageWidth(node.attrs.title));
            setOpen(true);
          }}
        >
          <Settings2 size={15} />
          {t("imageOptions")}
        </Button>
      </div>
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="image-preview-dialog">
          <DialogHeader>
            <DialogTitle>{t("imagePreview")}</DialogTitle>
            <DialogDescription>
              {node.attrs.alt || t("image")}
            </DialogDescription>
          </DialogHeader>
          <div className="image-preview">
            <LocalImage src={node.attrs.src} alt={node.attrs.alt} />
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("imageOptions")}</DialogTitle>
            <DialogDescription>{t("imageOptionsHint")}</DialogDescription>
          </DialogHeader>
          <label className="image-field">
            {t("imageAlt")}
            <Input
              aria-label={t("imageAlt")}
              maxLength={500}
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
            />
          </label>
          <label className="image-field">
            {t("imageSize")}
            <select
              aria-label={t("imageSize")}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
            >
              {[25, 50, 75, 100].map((n) => (
                <option key={n} value={n}>
                  {n}%
                </option>
              ))}
            </select>
          </label>
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              onClick={() => {
                editor.view.dispatch(closeHistory(editor.state.tr));
                updateAttributes({
                  alt,
                  title: imageTitle(node.attrs.title, width),
                });
                setOpen(false);
              }}
            >
              {t("save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </NodeViewWrapper>
  );
}
