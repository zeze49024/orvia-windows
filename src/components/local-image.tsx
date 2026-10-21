import { useEffect, useState } from "react";
import { ImagePlus } from "lucide-react";
import { store, getAsset } from "@/core/storage";
import { translator } from "@/i18n";

export function LocalImage({ src, alt }: { src?: string; alt?: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let current = "",
      live = true;
    setUrl("");
    const id = src?.match(/^asset:([a-f0-9]{64})$/)?.[1];
    const asset = store.data.assets.find((a) => a.id === id);
    if (asset)
      void getAsset(asset)
        .then((bytes) => {
          if (live) {
            current = URL.createObjectURL(
              new Blob([new Uint8Array(bytes).buffer], { type: asset.mime }),
            );
            setUrl(current);
          }
        })
        .catch(() => {});
    return () => {
      live = false;
      if (current) URL.revokeObjectURL(current);
    };
  }, [src]);
  return url ? (
    <img src={url} alt={alt ?? ""} />
  ) : (
    <span className="blocked-image">
      <ImagePlus size={16} />
      {translator(store.data.settings.locale)("blockedImage")}
    </span>
  );
}
