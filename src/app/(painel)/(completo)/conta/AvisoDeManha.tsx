"use client";

import { useEffect, useState } from "react";

import { apagarInscricaoPushAction, registrarFalhaDePushAction, registrarInscricaoPushAction } from "@/app/(painel)/_casca/push-acoes";
import { sistemaDeInstalacao } from "@/lib/convite-instalar";
import { textosPush } from "@/textos/push";
import { Botao } from "@/ui/componentes/Botao";
import { Cartao } from "@/ui/componentes/Cartao";
import { jaEstaInstalado } from "@/ui/instalacao";
import { descreverErro, desligarAviso, estadoDoAviso, inscricaoAtualDoAparelho, ligarAviso, type EstadoDoAviso } from "@/ui/push";

import styles from "./AvisoDeManha.module.css";

const t = textosPush.conta;

type Estado = EstadoDoAviso | "precisa_instalar" | "carregando";

type Props = {
  /** A chave pública VAPID, lida do servidor em tempo de execução; vazia, o aviso não existe neste ambiente e o cartão não aparece. */
  chavePublica: string;
  /** O horário do lembrete que a pessoa escolheu em "lembrete" (`HH:00`); o aviso chega nele. */
  horaLembrete: string;
  /** Sessão de admin: o passo e o motivo da falha aparecem embaixo da frase (item 0d); o cliente comum vê só a frase. */
  ehAdmin?: boolean;
};

/**
 * O cartão "Aviso de manhã" da Conta (E48 PR 2): o estado neste aparelho (ligado, desligado, sem permissão, ou precisa instalar o aplicativo) e o
 * botão para ligar ou desligar. O horário é o do campo de lembrete de sempre. Começa em "carregando" e decide depois de montar, porque só o
 * navegador sabe se está instalado, se suporta e em que estado está a permissão (o servidor daria diferença na hidratação).
 */
export function AvisoDeManha({ chavePublica, horaLembrete, ehAdmin = false }: Props) {
  const [estado, setEstado] = useState<Estado>("carregando");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<{ etapa: string; texto: string } | null>(null);

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      const novo: Estado = jaEstaInstalado() ? await estadoDoAviso() : "precisa_instalar";
      if (cancelado) return;
      setEstado(novo);
      // Ligado no navegador: reconcilia com o servidor (registrar é idempotente, e só aceita o aparelho de quem já o tem ou com chaves novas). Se o servidor recusar
      // (o aparelho é de outra pessoa que não saiu, ou a inscrição é inválida), o cartão não pode dizer "ligado": tira a inscrição do navegador e mostra "desligado".
      if (novo === "ligado") {
        const dados = await inscricaoAtualDoAparelho();
        if (dados) {
          const guardou = await registrarInscricaoPushAction(dados, sistemaDeInstalacao(navigator.userAgent)).catch(() => true);
          if (!guardou && !cancelado) {
            await desligarAviso().catch(() => null);
            setEstado("desligado");
          }
        }
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  if (!chavePublica || estado === "carregando") return null;

  /** Mostra a frase de sempre e, para o admin, o passo e o motivo; o log do servidor guarda os dois (sem endereço nem chave). */
  function falhou(etapa: string, texto: string) {
    setErro(t.erro);
    setMotivo({ etapa, texto });
    void registrarFalhaDePushAction(texto, etapa, sistemaDeInstalacao(navigator.userAgent)).catch(() => undefined);
  }

  async function ligar() {
    setOcupado(true);
    setErro(null);
    setMotivo(null);
    try {
      const resultado = await ligarAviso(chavePublica);
      if (resultado.tipo === "negado") {
        setEstado("sem_permissao");
        return;
      }
      if (resultado.tipo === "erro") {
        falhou(resultado.etapa, resultado.motivo);
        return;
      }
      if (!(await registrarInscricaoPushAction(resultado.inscricao, sistemaDeInstalacao(navigator.userAgent)))) {
        // O servidor não guardou: tira a inscrição do navegador também, para o cartão não dizer "ligado" sem aviso nenhum.
        await desligarAviso().catch(() => null);
        falhou("servidor", "o servidor recusou a inscrição");
        return;
      }
      if (resultado.endpointAntigo && resultado.endpointAntigo !== resultado.inscricao.endpoint) void apagarInscricaoPushAction(resultado.endpointAntigo).catch(() => undefined);
      setEstado("ligado");
    } catch (erro) {
      falhou("servidor", descreverErro(erro));
    } finally {
      setOcupado(false);
    }
  }

  async function desligar() {
    setOcupado(true);
    setErro(null);
    try {
      const endpoint = await desligarAviso();
      if (endpoint) await apagarInscricaoPushAction(endpoint);
      setEstado("desligado");
    } catch {
      setErro(t.erro);
    } finally {
      setOcupado(false);
    }
  }

  const frase =
    estado === "ligado"
      ? t.ligado
      : estado === "desligado"
        ? t.desligado
        : estado === "sem_permissao"
          ? t.semPermissao
          : estado === "precisa_instalar"
            ? t.precisaInstalar
            : t.semSuporte;

  return (
    <Cartao className={styles.aviso} data-testid="aviso-de-manha" data-estado-do-aviso={estado}>
      <h3 className={styles.titulo}>{t.titulo}</h3>
      <p className={styles.frase}>{frase}</p>
      {estado === "ligado" || estado === "desligado" ? <p className={styles.horario}>{t.horario(horaLembrete)}</p> : null}
      {estado === "desligado" ? (
        <Botao carregando={ocupado} onClick={ligar}>
          {t.ligar}
        </Botao>
      ) : null}
      {estado === "ligado" ? (
        <Botao variante="secundario" carregando={ocupado} onClick={desligar}>
          {t.desligar}
        </Botao>
      ) : null}
      {erro ? (
        <p className={styles.erro} role="alert">
          {erro}
          {ehAdmin && motivo ? <span className={styles.motivo}>{textosPush.motivoDoErro(motivo.etapa, motivo.texto)}</span> : null}
        </p>
      ) : null}
    </Cartao>
  );
}
