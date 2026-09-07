import { describe, expect, it } from "vitest";

import { faixaMeta } from "./notaFaixaMeta";

describe("faixaMeta", () => {
  it("na meta quando o valor atinge a meta", () => {
    expect(faixaMeta(8, 8)).toBe("naMeta");
    expect(faixaMeta(9, 8)).toBe("naMeta");
  });

  it("baixa abaixo de 6, mesmo com meta mais baixa", () => {
    expect(faixaMeta(5.9, 8)).toBe("baixa");
    expect(faixaMeta(0, 6)).toBe("baixa");
  });

  it("neutra entre 6 e a meta", () => {
    expect(faixaMeta(6, 8)).toBe("neutra");
    expect(faixaMeta(7.9, 8)).toBe("neutra");
  });
});
