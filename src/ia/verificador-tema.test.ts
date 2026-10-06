import { describe, expect, it } from "vitest";

import { acharIdSolto, acharTerceiraPessoa, verificarLocalmente } from "./verificador";

describe("a nota do tema não mostra id nem fala em terceira pessoa (achado do Gustavo, 06/10/2026)", () => {
  it("um número de cinco dígitos ou mais solto é id interno; separador, ano e número pequeno passam", () => {
    expect(acharIdSolto("o 109181 do Luan Santana e o 112344 sobre manter o controle")).toBe("109181");
    expect(acharIdSolto("como em 109369")).toBe("109369");
    expect(acharIdSolto("45.000 visualizações, 3x a mediana, em 2026, 12 vídeos")).toBeNull();
    expect(acharIdSolto("a conta tem 1.200.000 seguidores")).toBeNull();
    expect(acharIdSolto("um vídeo da conta @luansantana sobre construir audiência")).toBeNull();
  });

  it("terceira pessoa: 'ele quer', 'a experiência dele', 'o cliente tem', 'a pessoa precisa'; segunda pessoa passa", () => {
    expect(acharTerceiraPessoa("Como ele quer ficar conhecido por negócios e política")).not.toBeNull();
    expect(acharTerceiraPessoa("não mostra a experiência dele de ter feito o tráfego pago")).not.toBeNull();
    expect(acharTerceiraPessoa("o perfil diz que ele se posiciona por pauta")).not.toBeNull();
    expect(acharTerceiraPessoa("O cliente tem medo de errar")).not.toBeNull();
    expect(acharTerceiraPessoa("a pessoa precisa de um gancho")).not.toBeNull();
    expect(acharTerceiraPessoa("Você quer ficar conhecido por negócios e política")).toBeNull();
    expect(acharTerceiraPessoa("não mostra a sua experiência de ter feito o tráfego pago")).toBeNull();
    expect(acharTerceiraPessoa("o vídeo dele sobre limpeza")).toBeNull();
    expect(acharTerceiraPessoa("fale com o seu cliente sobre o medo dele de errar")).toBeNull();
  });

  it("verificarLocalmente só reprova quando a tarefa liga as duas regras, e diz o motivo certo", () => {
    const campos = { justificativaViralizar: "Existem o 109181 do Luan Santana e o 112344.", justificativaGerarCliente: "Como ele quer ficar conhecido, esse cruzamento ajuda." };
    expect(verificarLocalmente(campos, {}).aprovado).toBe(true);
    const r = verificarLocalmente(campos, { semIdInterno: true, soSegundaPessoa: true });
    expect(r.aprovado).toBe(false);
    expect(r.motivos.some((m) => m.startsWith("justificativaViralizar:") && m.includes("109181"))).toBe(true);
    expect(r.motivos.some((m) => m.startsWith("justificativaGerarCliente:") && m.includes("terceira pessoa"))).toBe(true);
    const limpo = { justificativaViralizar: "O banco do seu setor ainda não tem vídeo sobre isso.", justificativaGerarCliente: "Como você quer ficar conhecido, esse cruzamento ajuda." };
    expect(verificarLocalmente(limpo, { semIdInterno: true, soSegundaPessoa: true }).aprovado).toBe(true);
  });
});
