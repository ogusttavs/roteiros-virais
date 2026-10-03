"use client";

import { useRef, useState, type FormEvent } from "react";

import { dadosFixosDoBriefing } from "@/config/briefing";
import type { TemaPreferido, TipoMarca } from "@/db/schema";
import type { OndeValor } from "@/lib/onde";
import { montarCampoOnde } from "@/lib/onde";
import { normalizarSite, siteValido } from "@/lib/site-valido";
import { textosBriefing } from "@/textos/briefing";
import { textosConta } from "@/textos/conta";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";
import { CampoPerfilRede } from "@/ui/componentes/CampoPerfilRede";
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
  /** E38 PR 2: o site da marca, no mesmo lugar dos perfis (depois do YouTube), como o desenho do Opus pede. */
  siteInicial: string;
  temaInicial: TemaPreferido;
  horaLembreteInicial: string;
  /** V3, item 4: "Perfis nas redes" é da marca ativa, ganha o nome dela no subtítulo. */
  nomeMarca: string;
  /** E42a, item 1: "Onde está o seu público?" editável aqui, com as opções do tipo da marca. */
  tipo: TipoMarca;
  ondeInicial: OndeValor | null;
  regiaoInicial: string | null;
  paisInicial: string | null;
  paisesInicial: string | null;
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
  siteInicial,
  temaInicial,
  horaLembreteInicial,
  nomeMarca,
  tipo,
  ondeInicial,
  regiaoInicial,
  paisInicial,
  paisesInicial,
}: Props) {
  const dadosFixos = dadosFixosDoBriefing(tipo);
  const [nome, setNome] = useState(nomeInicial);
  const [instagram, setInstagram] = useState(instagramInicial);
  const [tiktok, setTiktok] = useState(tiktokInicial);
  const [youtube, setYoutube] = useState(youtubeInicial);
  const [site, setSite] = useState(siteInicial);
  const [onde, setOnde] = useState<OndeValor | "">(ondeInicial ?? "");
  const [regiao, setRegiao] = useState(regiaoInicial ?? "");
  const [pais, setPais] = useState(paisInicial ?? "");
  const [paises, setPaises] = useState(paisesInicial ?? "");
  const [tema, setTema] = useState<TemaPreferido>(temaInicial);
  const [horaLembrete, setHoraLembrete] = useState(horaLembreteInicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** O erro do campo do site fica no próprio campo (liga a ele por `aria-describedby`), não no pé do formulário. */
  const [erroSite, setErroSite] = useState<string | undefined>(undefined);
  const [toastAberto, setToastAberto] = useState(false);
  const tratarFalha = useTratarFalha();
  const { avisarRedeOk } = useConexao();

  const siteRef = useRef<HTMLInputElement>(null);

  const indiceTema = OPCOES_TEMA.findIndex((opcao) => opcao.valor === tema);
  const indiceOnde = dadosFixos.onde.opcoes.findIndex((opcao) => opcao.valor === onde);

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setErroSite(undefined);
    const horaArredondada = arredondarParaHoraCheia(horaLembrete);
    if (horaArredondada < HORA_LEMBRETE_MINIMA || horaArredondada > HORA_LEMBRETE_MAXIMA) {
      setErro(textosConta.erroHoraForaDaFaixa);
      return;
    }
    const siteNormalizado = normalizarSite(site);
    // O site só é conferido (e só vai ao servidor) se a pessoa mexeu nele: um endereço gravado antes da regra de agora (uma porta, um
    // IP) não pode impedir de salvar o nome, o tema ou o lembrete, e o servidor, sem o campo, não mexe no que está gravado.
    const siteMudou = siteNormalizado !== normalizarSite(siteInicial);
    if (siteMudou && siteNormalizado.length > 0 && !siteValido(siteNormalizado)) {
      setErroSite(textosBriefing.dadosFixos.siteInvalido);
      siteRef.current?.focus();
      return;
    }
    if (onde === "local" && regiao.trim().length === 0) {
      setErro(textosBriefing.dadosFixos.regiaoObrigatoria);
      return;
    }
    if (onde === "outro_pais" && pais.trim().length === 0) {
      setErro(textosBriefing.dadosFixos.paisObrigatorio);
      return;
    }
    if (onde === "mais_de_um_pais" && paises.trim().length === 0) {
      setErro(textosBriefing.dadosFixos.paisesObrigatorio);
      return;
    }
    setSalvando(true);
    try {
      await salvarContaAction({
        nome,
        perfis: { instagram, tiktok, youtube },
        ...(siteMudou ? { site: siteNormalizado } : {}),
        tema,
        horaLembrete: horaArredondada,
        // `onde` sempre preenchido: o cliente já passou pelo Começar antes de chegar na Conta.
        ...(onde ? montarCampoOnde(onde, regiao.trim(), pais.trim(), paises.trim()) : {}),
      });
      avisarRedeOk();
      if (siteMudou) setSite(siteNormalizado);
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
          <CampoPerfilRede
            plataforma="instagram"
            rotulo="Instagram"
            valor={instagram}
            onMudar={setInstagram}
            avisoInvalido={textosConta.perfilInvalido}
          />
          <CampoPerfilRede
            plataforma="tiktok"
            rotulo="TikTok"
            valor={tiktok}
            onMudar={setTiktok}
            avisoInvalido={textosConta.perfilInvalido}
          />
          <CampoPerfilRede
            plataforma="youtube"
            rotulo="YouTube"
            valor={youtube}
            onMudar={setYoutube}
            avisoInvalido={textosConta.perfilInvalido}
          />
          <Campo
            ref={siteRef}
            rotulo={dadosFixos.site.rotulo}
            ajuda={dadosFixos.site.ajuda}
            value={site}
            onChange={(e) => {
              setSite(e.target.value);
              setErroSite(undefined);
            }}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            erro={erroSite}
          />
        </div>

        <div className={styles.grupo}>
          <span className={styles.rotuloGrupo}>{dadosFixos.onde.rotulo}</span>
          <Chips
            rotuloGrupo={dadosFixos.onde.rotulo}
            opcoes={dadosFixos.onde.opcoes.map((opcao) => opcao.rotulo)}
            selecionado={indiceOnde}
            onChange={(indice) => setOnde(dadosFixos.onde.opcoes[indice].valor as OndeValor)}
          />
          {onde === "local" ? (
            <Campo
              rotulo={dadosFixos.onde.campoRegiao.rotulo}
              ajuda={dadosFixos.onde.campoRegiao.ajuda}
              value={regiao}
              onChange={(e) => setRegiao(e.target.value)}
            />
          ) : null}
          {onde === "outro_pais" ? (
            <Campo
              rotulo={dadosFixos.onde.campoPais.rotulo}
              ajuda={dadosFixos.onde.campoPais.ajuda}
              value={pais}
              onChange={(e) => setPais(e.target.value)}
            />
          ) : null}
          {onde === "mais_de_um_pais" ? (
            <Campo
              rotulo={dadosFixos.onde.campoPaises.rotulo}
              ajuda={dadosFixos.onde.campoPaises.ajuda}
              value={paises}
              onChange={(e) => setPaises(e.target.value)}
            />
          ) : null}
          {onde === "outro_pais" || onde === "mais_de_um_pais" ? (
            <p className={styles.subGrupo}>{dadosFixos.onde.avisoPesquisaNoBrasil}</p>
          ) : null}
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
