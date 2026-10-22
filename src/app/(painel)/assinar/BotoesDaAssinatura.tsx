"use client";

import { useState } from "react";

import { textosAssinatura } from "@/textos/assinatura";
import { Botao } from "@/ui/componentes/Botao";

import { abrirPortalAction, assinarAction } from "./acoes";

type Props = { jaTemAssinatura: boolean; podeAssinar: boolean };

/** E22 PR 1 (provisorio, o desenho e do PR 2): o botao que leva ao pagamento ou ao portal, e a frase quando algo da errado. */
export function BotoesDaAssinatura({ jaTemAssinatura, podeAssinar }: Props) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function ir(acao: typeof assinarAction) {
    setOcupado(true);
    setErro(null);
    try {
      const r = await acao();
      if (r.ok) {
        window.location.assign(r.dado.url);
        return;
      }
      setErro(r.erro);
    } catch {
      setErro(textosAssinatura.erroGenerico);
    }
    setOcupado(false);
  }

  return (
    <div>
      {podeAssinar ? (
        <Botao carregando={ocupado} precisaDeRede onClick={() => ir(assinarAction)}>
          {textosAssinatura.botaoAssinar}
        </Botao>
      ) : null}
      {jaTemAssinatura ? (
        <Botao variante="secundario" carregando={ocupado} precisaDeRede onClick={() => ir(abrirPortalAction)}>
          {textosAssinatura.botaoGerenciar}
        </Botao>
      ) : null}
      {erro ? <p role="alert">{erro}</p> : null}
    </div>
  );
}
