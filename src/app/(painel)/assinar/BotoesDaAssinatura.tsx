"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { textosAssinatura } from "@/textos/assinatura";
import { Botao } from "@/ui/componentes/Botao";

import { abrirPortalAction, assinarAction } from "./acoes";
import styles from "./page.module.css";

export type BotaoDaAssinatura = {
  acao: "assinar" | "portal" | "hoje" | "plano";
  rotulo: string;
  variante: "primario" | "secundario";
};

type Props = { botoes: BotaoDaAssinatura[]; tamanho?: "md" | "lg" };

/**
 * Os botões da assinatura, em `/assinar` e no cartão de Conta: "assinar" leva ao pagamento, "portal" ao portal do cliente (trocar o cartão, ver as faturas, cancelar), "hoje" volta ao
 * painel. A ação do servidor devolve o endereço (ou a frase do que deu errado); só o dono chega até aqui, e o servidor confere de novo.
 */
export function BotoesDaAssinatura({ botoes, tamanho = "md" }: Props) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<BotaoDaAssinatura["acao"] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function ir(acao: "assinar" | "portal") {
    setOcupado(acao);
    setErro(null);
    try {
      const r = await (acao === "assinar" ? assinarAction() : abrirPortalAction());
      if (r.ok) {
        window.location.assign(r.dado.url);
        return;
      }
      setErro(r.erro);
    } catch {
      setErro(textosAssinatura.erroGenerico);
    }
    setOcupado(null);
  }

  return (
    <div className={styles.botoes}>
      <div className={styles.botoesLinha}>
        {botoes.map((b) => (
          <Botao
            key={b.acao}
            variante={b.variante}
            tamanho={tamanho}
            carregando={ocupado === b.acao}
            disabled={ocupado !== null}
            precisaDeRede={b.acao === "assinar" || b.acao === "portal"}
            data-acao={b.acao}
            onClick={() => (b.acao === "hoje" ? router.push("/hoje") : b.acao === "plano" ? router.push("/assinar") : ir(b.acao))}
          >
            {b.rotulo}
          </Botao>
        ))}
      </div>
      {erro ? (
        <p role="alert" className={styles.erro}>
          {erro}
        </p>
      ) : null}
    </div>
  );
}
