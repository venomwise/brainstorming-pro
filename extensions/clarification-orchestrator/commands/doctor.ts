import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { collectPiDoctorReport, renderPiDoctorReport } from "../pi-doctor.ts";

export async function handleDoctorCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  try {
    const report = await collectPiDoctorReport();
    ctx.ui.notify(renderPiDoctorReport(report), "info");
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}
