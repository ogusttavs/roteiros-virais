"use client";

import { useEffect, useRef, useState } from "react";

import { adiarPedidoDePushAction, apagarInscricaoPushAction, registrarInscricaoPushAction } from "@/app/(painel)/_casca/push-acoes";
import { sistemaDoAparelho, type SistemaDoAparelho } from "@/lib/convite-instalar";
import { textosPush } from "@/textos/push";
import { Botao } from "@/ui/componentes/Botao";
import { Folha } from "@/ui/componentes/Folha";
import { jaEstaInstalado } from "@/ui/instalacao";
import { desligarAviso, ligarAviso, suportaPush } from "@/ui/push";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import styles from "./PedidoDeAviso.module.css";

const t = textosPush.pedido;

/** Quanto esperar depois de o aplicativo abrir: a tela aparece primeiro, e o pedido entra depois. */
const ESPERA_DO_PEDIDO_MS = 1500;

/** "Agora não" já foi dito nesta visita (vale até recarregar): o Voltar pode trazer a tela guardada, ainda dizendo que o pedido pode aparecer. */
let dispensadoNestaVisita = false;

type Props = {
  /** O servidor diz que o pedido pode aparecer (a pessoa não tem aparelho inscrito e o "agora não" não vale mais). */
  podeAparecer: boolean;
  /** A chave pública VAPID, lida do servidor em tempo de execução; vazia, nada é pedido. */
  chavePublica: string;
};

/**
 * O pedido de permissão do aviso de manhã (E48 PR 2): uma folha na primeira abertura do aplicativo instalado, no celular. "Quero" pede a permissão ao
 * navegador (em resposta ao toque), registra o service worker, inscreve o aparelho e manda a inscrição ao servidor. Nunca fora do aplicativo instalado
 * (no iPhone a permissão só existe lá) e nunca sem toque. "Agora não" adia sete dias no servidor, em qualquer aparelho da pessoa.
 */
export function PedidoDeAviso({ podeAparecer, chavePublica }: Props) {
  const [sistema, setSistema] = useState<SistemaDoAparelho>("outro");
  const [elegivel, setElegivel] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [dispensado, setDispensado] = useState(dispensadoNestaVisita);
  /** Fechar depois de ligar o aviso não é "agora não": não grava os sete dias, mas passa pelo mesmo caminho (que também desfaz a entrada do histórico). */
  const ligouAgora = useRef(false);

  // O navegador é quem sabe se é o aplicativo instalado, se o aparelho suporta e se a permissão ainda não foi decidida.
  useEffect(() => {
    const sistemaDoNavegador = sistemaDoAparelho(navigator.userAgent);
    setSistema(sistemaDoNavegador);
    setElegivel(sistemaDoNavegador !== "outro" && jaEstaInstalado() && suportaPush() && Notification.permission !== "denied");
  }, []);

  const devePedir = podeAparecer && Boolean(chavePublica) && elegivel && !dispensado;
  useEffect(() => {
    if (!devePedir || aberto) return;
    const espera = setTimeout(() => setAberto(true), ESPERA_DO_PEDIDO_MS);
    return () => clearTimeout(espera);
  }, [devePedir, aberto]);

  function adiar() {
    setAberto(false);
    setDispensado(true);
    dispensadoNestaVisita = true;
    if (!ligouAgora.current) void adiarPedidoDePushAction().catch(() => undefined);
  }

  const { fechar } = useFolhaNoHistorico(aberto, adiar);

  async function quero() {
    setOcupado(true);
    setErro(null);
    try {
      const resultado = await ligarAviso(chavePublica);
      if (resultado.tipo === "negado") {
        // A pessoa disse não ao pedido do navegador: o "agora não" vale do mesmo jeito.
        fechar();
        return;
      }
      if (resultado.tipo === "erro" || !(await registrarInscricaoPushAction(resultado.inscricao, sistema))) {
        // O servidor não guardou: tira a inscrição do navegador também (a permissão ficou dada, e o pedido não voltaria a aparecer).
        if (resultado.tipo === "ligado") await desligarAviso().catch(() => null);
        setErro(t.erro);
        return;
      }
      // A inscrição que o navegador tinha (a que foi trocada) sai do servidor: sem isto ela ficava órfã até o primeiro 404 ou 410 de um envio.
      if (resultado.endpointAntigo && resultado.endpointAntigo !== resultado.inscricao.endpoint) void apagarInscricaoPushAction(resultado.endpointAntigo).catch(() => undefined);
      ligouAgora.current = true;
      fechar();
    } catch {
      setErro(t.erro);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Folha
      titulo={t.titulo}
      aberto={aberto}
      aoFechar={fechar}
      rodape={
        <>
          <Botao carregando={ocupado} onClick={quero}>
            {ocupado ? t.ligando : t.quero}
          </Botao>
          <Botao variante="ghost" disabled={ocupado} onClick={fechar}>
            {t.agoraNao}
          </Botao>
        </>
      }
    >
      <div className={styles.pedido} data-pedido-de-aviso>
        <p className={styles.explica}>{t.explica}</p>
        {erro ? (
          <p className={styles.erro} role="alert">
            {erro}
          </p>
        ) : null}
      </div>
    </Folha>
  );
}
