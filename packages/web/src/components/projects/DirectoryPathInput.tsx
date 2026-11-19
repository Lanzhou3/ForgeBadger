"use client";

import { useEffect, useState } from "react";
import { FolderOpen, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/hooks/use-language";
import { getDesktopCapabilities, selectNativeDirectory } from "@/lib/api";
import { cn } from "@/lib/utils";

interface DirectoryPathInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Text input paired with a native host directory-picker trigger when supported
 * by the Gateway capability flags.
 */
export function DirectoryPathInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: DirectoryPathInputProps) {
  const { t } = useLanguage();
  const [supported, setSupported] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getDesktopCapabilities()
      .then((capabilities) => {
        if (active) setSupported(capabilities.directoryPickerSupported);
      })
      .catch(() => {
        if (active) setSupported(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handlePickDirectory() {
    if (picking || disabled) return;
    setPicking(true);
    setPickerError(null);
    try {
      const result = await selectNativeDirectory();
      if (!result.supported) {
        setPickerError(result.reason || t("projects.failedPickDirectory"));
      } else if (result.path) {
        onChange(result.path);
      }
    } catch (error) {
      setPickerError(
        error instanceof Error ? error.message : t("projects.failedPickDirectory"),
      );
    } finally {
      setPicking(false);
    }
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
        {supported && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            title={t("projects.browseDirectory")}
            aria-label={t("projects.browseDirectory")}
            disabled={disabled || picking}
            aria-busy={picking}
            onClick={handlePickDirectory}
          >
            {picking ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <FolderOpen className="size-4" />
            )}
          </Button>
        )}
      </div>
      {pickerError && (
        <p role="alert" className="text-xs text-destructive">
          {pickerError}
        </p>
      )}
    </div>
  );
}
