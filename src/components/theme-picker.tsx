import { DropdownMenu } from "radix-ui";
import { Check, Shirt } from "lucide-react";
import { themeRegistry, resolveTheme } from "@/core/themes";
import { translator } from "@/i18n";
import type { Locale } from "@/core/model";
import { Button } from "./ui/button";

export function ThemePicker({
  value,
  locale,
  onChange,
}: {
  value: string;
  locale: Locale;
  onChange: (id: string) => void;
}) {
  const t = translator(locale);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("theme")}
          title={t("theme")}
        >
          <Shirt size={17} />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="heading-menu theme-menu"
          sideOffset={9}
          align="end"
        >
          <DropdownMenu.Label className="theme-menu-label">
            {t("theme")}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={resolveTheme(value).id}
            onValueChange={onChange}
          >
            {themeRegistry.map((theme) => (
              <DropdownMenu.RadioItem
                key={theme.id}
                value={theme.id}
                className="heading-menu-item theme-menu-item"
              >
                <span
                  className="theme-swatch"
                  aria-hidden="true"
                  style={{
                    background: theme.preview[0],
                    color: theme.preview[1],
                  }}
                >
                  <span style={{ background: theme.preview[2] }} />
                </span>
                <span>{theme.names[locale]}</span>
                <DropdownMenu.ItemIndicator className="theme-checked">
                  <Check size={14} />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
