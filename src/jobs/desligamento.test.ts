import type { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import { desligarComGraca } from "./desligamento";

describe("desligarComGraca", () => {
  it("fecha o pg-boss com graceful: true, para o job em andamento terminar em vez de ficar preso como ativo", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const bossFalso = { stop } as unknown as PgBoss;

    await desligarComGraca(bossFalso, "SIGTERM");

    expect(stop).toHaveBeenCalledWith({ graceful: true });
  });
});
