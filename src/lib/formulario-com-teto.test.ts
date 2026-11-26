import { describe, expect, it } from "vitest";

import { lerFormularioComTeto } from "./formulario-com-teto";

async function pedido(corpo: FormData): Promise<Request> {
  const montado = new Request("http://localhost/x", { method: "POST", body: corpo });
  return new Request("http://localhost/x", { method: "POST", headers: { "content-type": montado.headers.get("content-type") ?? "" }, body: new Uint8Array(await montado.arrayBuffer()) });
}

describe("lerFormularioComTeto (M5)", () => {
  it("devolve o formulário quando cabe no teto", async () => {
    const f = new FormData();
    f.set("legenda", "oi");
    f.set("audio", new File([new Uint8Array(100)], "a.webm", { type: "audio/webm" }));
    const lido = await lerFormularioComTeto(await pedido(f), 10_000);
    expect(lido).not.toBe("grande-demais");
    const forma = lido as FormData;
    expect(forma.get("legenda")).toBe("oi");
    expect((forma.get("audio") as File).size).toBe(100);
  });
  it("para de ler e recusa quando passa do teto, sem Content-Length", async () => {
    const f = new FormData();
    f.set("audio", new File([new Uint8Array(5000)], "a.webm"));
    expect(await lerFormularioComTeto(await pedido(f), 1000)).toBe("grande-demais");
  });
});
