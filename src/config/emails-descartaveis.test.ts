import { describe, expect, it } from "vitest";

import { emailEhDescartavel } from "./emails-descartaveis";

describe("emailEhDescartavel", () => {
  it("pega o domínio da lista, com qualquer caixa, e os subdomínios dele", () => {
    expect(emailEhDescartavel("a@mailinator.com")).toBe(true);
    expect(emailEhDescartavel("A@YopMail.COM")).toBe(true);
    expect(emailEhDescartavel("a@caixa.guerrillamail.com")).toBe(true);
  });
  it("deixa passar e-mail de verdade e domínio que só termina parecido", () => {
    expect(emailEhDescartavel("ana@gmail.com")).toBe(false);
    expect(emailEhDescartavel("ana@padariadaana.com.br")).toBe(false);
    expect(emailEhDescartavel("ana@naomailinator.com")).toBe(false);
    expect(emailEhDescartavel("sem-arroba")).toBe(false);
  });
});
