"use client";

import { useEffect, useState } from "react";

import { apagarInscricaoPushAction, registrarInscricaoPushAction } from "@/app/(painel)/_casca/push-acoes";
import { sistemaDeInstalacao } from "@/lib/convite-instalar";
import { textosPush } from "@/textos/push";
import { Botao } from "@/ui/componentes/Botao";
import { Cartao } from "@/ui/componentes/Cartao";
import { jaEstaInstalado } from "@/ui/instalacao";
import { desligarAviso, estadoDoAviso, ligarAviso, type EstadoDoAviso } from "@/ui/push";

import styles from "./AvisoDeManha.module.css";

const t = textosPush.conta;

type Estado = EstadoDoAviso | "precisa_instalar" | "carregando";

type Props = {
  /** A chave pública VAPID, lida do servidor em tempo de execução; vazia, o aviso não existe neste ambiente e o cartão não aparece. */
  chavePublica: string;
  /** O horário do lembrete que a pessoa escolheu em "lembrete" (`HH:00`); o aviso chega nele. */
  horaLembrete: string;
};

/**
 * O cartão "Aviso de manhã" da Conta (E48 PR 2): o estado neste aparelho (ligado, desligado, sem permissão, ou precisa instalar o aplicativo) e o
 * botão para ligar ou desligar. O horário é o do campo de lembrete de sempre. Começa em "carregando" e decide depois de montar, porque só o
 * navegador sabe se está instalado, se suporta e em que estado está a permissão (o servidor daria diferença na hidratação).
 */
export function AvisoDeManha({ chavePublica, horaLembrete }: Props) {
  const [estado, setEstado] = useState<Estado>("carregando");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      const novo: Estado = jaEstaInstalado() ? await estadoDoAviso() : "precisa_instalar";
      if (!cancelado) setEstado(novo);
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  if (!chavePublica || estado === "carregando") return null;

  async function ligar() {
    setOcupado(true);
    setErro(null);
    try {
      const resultado = await ligarAviso(chavePublica);
      if (resultado.tipo === "negado") {
        setEstado("sem_permissao");
        return;
      }
      if (resultado.tipo === "erro" || !(await registrarInscricaoPushAction(resultado.inscricao, sistemaDeInstalacao(navigator.userAgent)))) {
        setErro(textosPush.pedido.erro);
        return;
      }
      setEstado("ligado");
    } catch {
      setErro(textosPush.pedido.erro);
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
      setErro(textosPush.pedido.erro);
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
        </p>
      ) : null}
    </Cartao>
  );
}
