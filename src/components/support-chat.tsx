"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { chatAllowedOn, type ChatConfig, type ChatVisitor } from "@/lib/chat";

type SalesIq = {
  widgetcode: string; values: Record<string, unknown>; ready: () => void;
  visitor?: { info?: (i: ChatVisitor) => void };
  floatbutton?: { visible?: (s: "show" | "hide") => void };
  reset?: () => void;
};
type ZohoWindow = Window & { $zoho?: { salesiq?: SalesIq } };
const z = () => (window as ZohoWindow).$zoho?.salesiq;
const safely = (fn: () => void) => { try { fn(); } catch { /* the chat is optional: it must never break a page */ } };

// The workspace tells the chat who is asking (company, plan, state; never a person's details). Kept here so the button, which lives on every allowed page, can use it.
let visitor: ChatVisitor | null = null;
const applyVisitor = () => safely(() => { if (visitor) z()?.visitor?.info?.(visitor); });

/**
 * The support chat button (ADR-037). Mounted once in the root layout, so one chat carries on as a person moves between pages. It asks /api/chat-config for the widget code (public by
 * nature: it is in the page source of any site that uses the widget), loads Zoho SalesIQ from Zoho's own address, and shows the button only on the pages in chatAllowedOn: the public
 * pages and the workspace, never the operator's area or a one-time link. Without a valid setting nothing is loaded.
 */
export function SupportChat() {
  const pathname = usePathname();
  const config = useRef<ChatConfig | null | undefined>(undefined);   // undefined: not asked yet; null: not set up

  useEffect(() => {
    let cancelled = false;
    const allowed = chatAllowedOn(pathname);
    const show = (c: ChatConfig) => {
      const w = window as ZohoWindow;
      if (document.getElementById("zsiqscript")) { safely(() => z()?.floatbutton?.visible?.(allowed ? "show" : "hide")); return; }
      if (!allowed) return;
      const s: SalesIq = { widgetcode: c.code, values: {}, ready: () => { applyVisitor(); safely(() => z()?.floatbutton?.visible?.("show")); } };
      w.$zoho = { ...(w.$zoho ?? {}), salesiq: s };
      const el = document.createElement("script");
      el.id = "zsiqscript"; el.defer = true; el.src = `https://${c.host}/widget`;
      document.body.appendChild(el);
    };
    if (config.current === null) return;
    if (config.current) { show(config.current); return; }
    fetch("/api/chat-config", { credentials: "omit" }).then((r) => (r.ok ? r.json() : null)).then((j: Partial<ChatConfig> | null) => {
      if (cancelled) return;
      config.current = j?.code && j.host ? { code: j.code, host: j.host } : null;
      if (config.current) show(config.current);
    }).catch(() => { config.current = null; });
    return () => { cancelled = true; };
  }, [pathname]);
  return null;
}

/**
 * Rendered inside a signed-in workspace: tells the chat who is asking, and when the person leaves the workspace (or signs out) it ends the chat session and clears those details, so the
 * next person on the same device never sees the previous company's chat.
 */
export function ChatVisitorInfo({ info }: { info: ChatVisitor }) {
  useEffect(() => {
    visitor = info;
    applyVisitor();
    return () => { visitor = null; safely(() => z()?.reset?.()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the four fields are the whole of `info`; depending on the object would end the chat on every refresh
  }, [info.Company, info.Workspace, info.Plan, info.Status]);
  return null;
}
