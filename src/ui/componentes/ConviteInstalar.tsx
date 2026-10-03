"use client";

import { Share } from "lucide-react";
import { useEffect, useState } from "react";

import { adiarConviteDeInstalarAction } from "@/app/(painel)/_casca/instalar-acoes";
import { sistemaDoAparelho, type SistemaDoAparelho } from "@/lib/convite-instalar";
import { textosInstalar } from "@/textos/instalar";
import { Botao } from "@/ui/componentes/Botao";
import { Folha } from "@/ui/componentes/Folha";
import { jaEstaInstalado, usePedidoDeInstalacao } from "@/ui/instalacao";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import styles from "./ConviteInstalar.module.css";

const t = textosInstalar.convite;

/** Quanto esperar depois de a tela do roteiro montar: o roteiro aparece primeiro, e o convite entra depois, nunca por cima do carregamento. */
const ESPERA_DO_CONVITE_MS = 1500;

/**
 * "Agora não" já foi dito nesta visita ao aplicativo (vale até recarregar): o Voltar do aplicativo pode trazer de volta a tela do roteiro guardada, ainda
 * dizendo que o convite pode aparecer, e ele não deve reabrir por causa disso. O servidor guarda os sete dias; isto só cobre a visita.
 */
let dispensadoNestaVisita = false;

type Props = {
  /** O servidor diz que o convite pode aparecer (não instalou e o "agora não" não vale mais). */
  podeAparecer: boolean;
  /** A tela está livre: nenhuma outra folha aberta e ninguém editando. */
  telaLivre: boolean;
};

/**
 * O convite de instalar o aplicativo no celular (E48 PR 1, decisão do Gustavo de 03/10: não no login, e sim na primeira vez que a pessoa gera
 * um roteiro). Uma folha, uma vez por pessoa, só no celular e só enquanto o aplicativo não está instalado. Android com o pedido do navegador:
 * o botão "Adicionar ao celular". Sem o pedido, e no iPhone: os passos escritos. "Agora não" fecha e não volta por sete dias (no servidor).
 */
export function ConviteInstalar({ podeAparecer, telaLivre }: Props) {
  const [sistema, setSistema] = useState<SistemaDoAparelho>("outro");
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  /** "Agora não" já foi dito nesta visita: o convite não reabre sozinho enquanto a tela estiver montada. */
  const [dispensado, setDispensado] = useState(dispensadoNestaVisita);
  const { disponivel, instalar } = usePedidoDeInstalacao();

  // O aparelho só o navegador sabe (e se já está instalado): decide depois de montar, como o cartão da Conta.
  useEffect(() => {
    const sistemaDoNavegador = sistemaDoAparelho(navigator.userAgent);
    setSistema(sistemaDoNavegador !== "outro" && !jaEstaInstalado() ? sistemaDoNavegador : "outro");
  }, []);

  const devePedir = podeAparecer && telaLivre && sistema !== "outro" && !dispensado;
  useEffect(() => {
    if (!devePedir || aberto) return;
    const espera = setTimeout(() => setAberto(true), ESPERA_DO_CONVITE_MS);
    return () => clearTimeout(espera);
  }, [devePedir, aberto]);

  function adiar() {
    setAberto(false);
    setDispensado(true);
    dispensadoNestaVisita = true;
    // Fechou: o servidor guarda o "agora não" (a falha de rede só deixa o convite voltar antes; nada se perde).
    void adiarConviteDeInstalarAction().catch(() => undefined);
  }

  const { fechar } = useFolhaNoHistorico(aberto, adiar);

  async function adicionar() {
    setOcupado(true);
    try {
      await instalar();
    } catch {
      // O pedido do navegador só vale com um toque e uma vez; se ele recusar, a folha fecha do mesmo jeito (sete dias sem convite).
    } finally {
      setOcupado(false);
      // Aceitou ou recusou o pedido do navegador, a folha cumpriu o papel: quem aceitou aparece como instalado na primeira abertura do aplicativo,
      // quem recusou não vê o convite de novo por sete dias.
      fechar();
    }
  }

  if (sistema === "outro") return null;

  const comBotao = sistema === "android" && disponivel;
  return (
    <Folha
      titulo={t.titulo}
      aberto={aberto}
      aoFechar={fechar}
      rodape={
        <>
          {comBotao ? (
            <Botao carregando={ocupado} onClick={adicionar}>
              {ocupado ? t.adicionando : t.adicionar}
            </Botao>
          ) : null}
          <Botao variante="ghost" disabled={ocupado} onClick={fechar}>
            {t.agoraNao}
          </Botao>
        </>
      }
    >
      <div className={styles.convite} data-convite-instalar={sistema}>
        <p className={styles.explica}>{t.explica}</p>
        {sistema === "iphone" ? (
          <ol className={styles.passos}>
            {t.iphone.passos.map((passo, indice) => (
              <li key={passo}>
                <span className={styles.numero} aria-hidden="true">
                  {indice + 1}
                </span>
                <span className={styles.texto}>
                  {passo}
                  {indice === 0 ? <Share size={16} strokeWidth={1.75} aria-hidden="true" className={styles.icone} /> : null}
                </span>
              </li>
            ))}
          </ol>
        ) : comBotao ? null : (
          <p className={styles.semBotao}>{t.android.semBotao}</p>
        )}
      </div>
    </Folha>
  );
}
