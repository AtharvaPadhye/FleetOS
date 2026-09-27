"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Upload } from "lucide-react";
import { cn } from "@fleetos/ui/lib/cn";

interface AttachmentView {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  url: string;
}

const ACCEPT = "image/jpeg,image/png,image/heic,image/heif,application/pdf,.heic,.heif";
const MAX = 20 * 1024 * 1024;
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

/**
 * Evidence on a ticket (PRD SV-4): drag-and-drop or picker, JPEG/PNG/HEIC/PDF up to 20 MB, upload progress,
 * thumbnails for JPEG/PNG. Files open through short-lived signed URLs; the server checks each file's real type.
 */
export function TicketAttachments({
  ticketId,
  orgId,
  items,
  canUpload,
}: {
  ticketId: string;
  orgId: string;
  items: AttachmentView[];
  canUpload: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const upload = (file: File) => {
    setError(null);
    if (file.size > MAX) return setError(`${file.name} is over 20 MB.`);
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/v1/tickets/${ticketId}/attachments`);
    xhr.setRequestHeader("X-FleetOS-Org", orgId);
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setProgress(null);
      if (xhr.status === 201) router.refresh();
      else {
        try {
          setError((JSON.parse(xhr.responseText) as { message: string }).message);
        } catch {
          setError("Upload failed. Try again.");
        }
      }
    };
    xhr.onerror = () => {
      setProgress(null);
      setError("Upload failed. Check your connection and try again.");
    };
    setProgress(0);
    xhr.send(form);
  };

  return (
    <section aria-labelledby="attachments" className="flex flex-col gap-3">
      <h2 id="attachments" className="text-title font-semibold">
        Photos and documents
      </h2>
      {items.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((a) => (
            <li key={a.id}>
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="flex flex-col gap-1 rounded-sm border border-divider p-2 hover:bg-raised"
              >
                {a.content_type === "image/jpeg" || a.content_type === "image/png" ? (
                  // Signed, expiring storage URLs: next/image would cache them past expiry.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={a.filename} className="aspect-video w-full rounded-sm object-cover" />
                ) : (
                  <span className="flex aspect-video items-center justify-center rounded-sm bg-raised text-fg-muted">
                    <FileText aria-hidden="true" className="size-8" />
                  </span>
                )}
                <span className="truncate text-label">{a.filename}</span>
                <span className="text-label text-fg-muted">{kb(a.size_bytes)}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-fg-muted">No photos or documents yet.</p>
      )}
      {canUpload ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) upload(f);
          }}
          className={cn(
            "flex flex-col items-start gap-2 rounded-md border border-dashed p-4",
            over ? "border-fg bg-raised" : "border-border-strong",
          )}
        >
          <p className="text-fg-muted">Drop a photo or PDF here (JPEG, PNG, HEIC or PDF, up to 20 MB), or</p>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border border-border-control px-4 text-body font-medium hover:bg-raised lg:min-h-9">
            <Upload aria-hidden="true" className="size-4" /> Choose a file
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = "";
              }}
            />
          </label>
          {progress !== null ? (
            <progress value={progress} max={100} aria-label="Upload progress" className="w-full">
              {progress}%
            </progress>
          ) : null}
          {error ? (
            <p role="alert" className="text-label text-severity-high">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
