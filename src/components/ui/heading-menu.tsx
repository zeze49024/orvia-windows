import { DropdownMenu } from "radix-ui";
import { useRef } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "./button";

export function HeadingMenu({
  value,
  label,
  paragraph,
  onChange,
}: {
  value: number;
  label: string;
  paragraph: string;
  onChange: (level: number) => void;
}) {
  const chosen = useRef(false);
  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        if (open) chosen.current = false;
      }}
    >
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="heading-picker"
          aria-label={label}
          title={label}
          onMouseDown={(event) => event.preventDefault()}
        >
          <span>{value ? `H${value}` : paragraph}</span>
          <ChevronDown size={11} />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="heading-menu"
          sideOffset={7}
          align="start"
          onCloseAutoFocus={(event) => {
            if (chosen.current) event.preventDefault();
          }}
        >
          <DropdownMenu.RadioGroup
            value={String(value)}
            onValueChange={(value) => {
              chosen.current = true;
              onChange(Number(value));
            }}
          >
            {[0, 1, 2, 3, 4, 5, 6].map((level) => (
              <DropdownMenu.RadioItem
                key={level}
                value={String(level)}
                className="heading-menu-item"
              >
                <span className="heading-menu-check">
                  <DropdownMenu.ItemIndicator>
                    <Check size={13} />
                  </DropdownMenu.ItemIndicator>
                </span>
                <span
                  className="heading-menu-name"
                  style={{
                    fontSize: level ? 20 - level : 12,
                    fontWeight: level ? 600 : 400,
                  }}
                >
                  {level ? `${label} ${level}` : paragraph}
                </span>
                <span className="heading-menu-shortcut">
                  {level ? `H${level}` : "P"}
                </span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
