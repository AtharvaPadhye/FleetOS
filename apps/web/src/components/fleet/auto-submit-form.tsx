"use client";

import type { ComponentProps } from "react";

/** A GET form that applies select changes immediately (URL-driven filters still work without JS via the button). */
export function AutoSubmitForm(props: ComponentProps<"form">) {
  return (
    <form
      {...props}
      onChange={(e) => {
        if ((e.target as HTMLElement).tagName === "SELECT") e.currentTarget.requestSubmit();
      }}
    />
  );
}
