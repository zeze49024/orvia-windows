import { Star } from "lucide-react";
import { Button } from "./ui/button";

/** One visual/accessible toggle shared by the document and library views. */
export function FavoriteButton({
  starred,
  label,
  onClick,
}: {
  starred: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="favorite-button"
      aria-label={label}
      title={label}
      aria-pressed={starred}
      onClick={onClick}
    >
      <Star
        size={18}
        strokeWidth={2}
        fill={starred ? "currentColor" : "none"}
      />
    </Button>
  );
}
