"use client";

import { useState, type FormEvent } from "react";

import type { TemaPreferido } from "@/db/schema";
import { textosConta } from "@/textos/conta";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";
import { Chips } from "@/ui/componentes/Chips";
import { Toast } from "@/ui/componentes/Toast";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";

import { salvarContaAction } from "./acoes";
import styles from "./page.module.css";

type Props = {
  nomeInicial: string;
  email: string;
  instagramInicial: string;
  tiktokInicial: string;
  youtubeInicial: string;
  temaInicial: TemaPreferido;
  horaLembreteInicial: string;
  /** V3, item 4: "Perfis nas redes" é da marca ativa, ganha o nome dela no subtítulo. */
  nomeMarca: string;
};

const OPCOES_TEMA = textosConta.temas;
/**
 * Mesma faixa de `salvarPerfilConta` (etapa 13, ajuste 3): o tema do dia
 * nasce as 05:30. Checada aqui tambem porque o navegador nao bloqueia um
 * valor fora do `min`/`max` do campo quando o envio passa pelo `onSubmit`
 * em vez da validacao nativa do formulario (ajuste 4).
 */
const HORA_LEMBRETE_MINIMA = "06:00";
const HORA_LEMBRETE_MAXIMA = "22:00";

/**
 * Mesmo arredondamento de `salvarPerfilConta` (etapa 13, ajuste 4): a faixa
 * acima precisa comparar contra a hora que vai ser gravada de verdade, não
 * contra o valor bruto do campo. Achado da revisão adversarial desta etapa:
 * sem isso, "22:30" (que o servidor aceita, arredondando para "22:00") caía
 * na recusa do cliente antes mesmo de chamar a Server Action.
 */
function arredondarParaHoraCheia(horaMinuto: string): string {
  const [hora] = horaMinuto.split(":");
  return `${hora}:00`;
}

/**
 * `persistir` so depois de salvar (V7, item 4 do PROXIMO.md): tocar no chip mostra o tema na hora (o tema e
 * local, nao precisa de rede), mas so o "salvar" bem sucedido o grava no navegador. Sem isso, quem toca
 * "Escuro" e sai sem salvar ficaria escuro a cada recarga com a conta guardando "do sistema".
 */
function aplicarTema(tema: TemaPreferido, persistir: boolean) {
  if (tema === "claro" || tema === "escuro") {
    document.documentElement.setAttribute("data-tema", tema);
  } else {
    document.documentElement.removeAttribute("data-tema");
  }
  if (!persistir) return;
  try {
    localStorage.setItem("tema", tema);
  } catch {
    // localStorage pode falhar (modo privado); o banco ja e a fonte de verdade.
  }
}

export function FormularioConta({
  nomeInicial,
  email,
  instagramInicial,
  tiktokInicial,
  youtubeInicial,
  temaInicial,
  horaLembreteInicial,
  nomeMarca,
}: Props) {
  const [nome, setNome] = useState(nomeInicial);
  const [instagram, setInstagram] = useState(instagramInicial);
  const [tiktok, setTiktok] = useState(tiktokInicial);
  const [youtube, setYoutube] = useState(youtubeInicial);
  const [tema, setTema] = useState<TemaPreferido>(temaInicial);
  const [horaLembrete, setHoraLembrete] = useState(horaLembreteInicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [toastAberto, setToastAberto] = useState(false);
  const tratarFalha = useTratarFalha();
  const { avisarRedeOk } = useConexao();

  const indiceTema = OPCOES_TEMA.findIndex((opcao) => opcao.valor === tema);

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    const horaArredondada = arredondarParaHoraCheia(horaLembrete);
    if (horaArredondada < HORA_LEMBRETE_MINIMA || horaArredondada > HORA_LEMBRETE_MAXIMA) {
      setErro(textosConta.erroHoraForaDaFaixa);
      return;
    }
    setSalvando(true);
    try {
      await salvarContaAction({ nome, perfis: { instagram, tiktok, youtube }, tema, horaLembrete: horaArredondada });
      avisarRedeOk();
      // Já foi aplicado ao tocar no chip; aqui o servidor guardou, então o navegador também guarda.
      aplicarTema(tema, true);
      setToastAberto(true);
    } catch (falha) {
      // Sem rede, a causa é a rede (V7, item 4 do PROXIMO.md), não "tente de novo em um minuto".
      setErro(tratarFalha(falha, textosConta.erro));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <form className={styles.forma} onSubmit={salvar}>
        <Campo rotulo={textosConta.nome} value={nome} onChange={(e) => setNome(e.target.value)} required />
        <Campo
          rotulo={`${textosConta.email} ${textosConta.soLeitura}`}
          value={email}
          readOnly
          disabled
        />

        <div className={styles.grupo}>
          <span className={styles.rotuloGrupo}>{textosConta.redes}</span>
          <p className={styles.subGrupo}>{textosConta.redesSub(nomeMarca)}</p>
          <Campo rotulo="Instagram" value={instagram} onChange={(e) => setInstagram(e.target.value)} />
          <Campo rotulo="TikTok" value={tiktok} onChange={(e) => setTiktok(e.target.value)} />
          <Campo rotulo="YouTube" value={youtube} onChange={(e) => setYoutube(e.target.value)} />
        </div>

        <Campo
          type="time"
          step={3600}
          min={HORA_LEMBRETE_MINIMA}
          max={HORA_LEMBRETE_MAXIMA}
          rotulo={textosConta.lembrete}
          value={horaLembrete}
          onChange={(e) => setHoraLembrete(e.target.value)}
        />

        <div className={styles.grupo}>
          <span className={styles.rotuloGrupo}>{textosConta.tema}</span>
          <Chips
            rotuloGrupo={textosConta.tema}
            opcoes={OPCOES_TEMA.map((opcao) => opcao.rotulo)}
            selecionado={indiceTema}
            onChange={(indice) => {
              // O tema é local: aplica na hora, sem esperar o servidor (sem rede o toque no chip não fazia nada).
              // O que fica guardado na conta continua sendo só o do "salvar".
              const escolhido = OPCOES_TEMA[indice].valor as TemaPreferido;
              setTema(escolhido);
              aplicarTema(escolhido, false);
            }}
          />
        </div>

        {erro ? (
          <p className={styles.erro} role="alert">
            {erro}
          </p>
        ) : null}

        <Botao type="submit" variante="secundario" carregando={salvando} precisaDeRede className={styles.botaoSalvar}>
          {salvando ? textosConta.salvando : textosConta.salvar}
        </Botao>
      </form>
      <Toast texto={textosConta.salvo} aberto={toastAberto} onFechar={() => setToastAberto(false)} />
    </>
  );
}
