"use client";

import { useRef, useState, type FormEvent } from "react";

import { dadosFixosDoBriefing } from "@/config/briefing";
import type { TemaPreferido, TipoMarca } from "@/db/schema";
import { normalizarBusca } from "@/lib/buscar-ramo";
import type { OndeValor } from "@/lib/onde";
import { montarCampoOnde } from "@/lib/onde";
import { normalizarSite, siteValido } from "@/lib/site-valido";
import { textosBriefing } from "@/textos/briefing";
import { textosConta } from "@/textos/conta";
import { textosRamo } from "@/textos/ramo";
import { Botao } from "@/ui/componentes/Botao";
import { BuscaDeRamo } from "@/ui/componentes/BuscaDeRamo";
import { Campo } from "@/ui/componentes/Campo";
import { CampoPerfilRede } from "@/ui/componentes/CampoPerfilRede";
import { Chips } from "@/ui/componentes/Chips";
import { Toast } from "@/ui/componentes/Toast";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";

import { salvarContaAction, type PedidoDeRamoNaTela } from "./acoes";
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
  /** E45, PR 1: o ramo da marca: do catálogo (com `slug`) ou um setor que o admin criou à mão (`slug` nulo, só o nome). */
  ramoInicial: { slug: string | null; nome: string } | null;
  /** E45 PR 2: o pedido de ramo aberto da marca (o "Não achei o meu") e o ramo provisório em que ela espera. */
  pedidoDeRamo: PedidoDeRamoNaTela | null;
  /** E45 PR 3: os nomes dos ramos alternativos que o admin ligou, só leitura (a Conta não liga nem desliga). */
  ramosAlternativos?: string[];
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
  ramoInicial,
  pedidoDeRamo: pedidoDeRamoInicial,
  ramosAlternativos = [],
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
  /**
   * O site que está gravado: o da página ao abrir, e o que a pessoa acabou de salvar (a página não recarrega depois do "salvar"). Sem isto, trocar o
   * site, salvar e voltar ao de antes comparava com o de ANTES do primeiro salvar e não mandava nada: a tela dizia "salvo" com o site errado
   * gravado (o mesmo defeito do ramo, achado na revisão do PR 1 da E45 e deixado aqui desde a E38 PR 2; decisão 39).
   */
  const [siteSalvo, setSiteSalvo] = useState(siteInicial);
  /** O ramo do catálogo escolhido agora. Nulo: nada escolhido, ou o ramo de hoje não é do catálogo e a pessoa não escolheu outro. */
  const [ramo, setRamo] = useState<string | null>(ramoInicial?.slug ?? null);
  /**
   * O ramo que está gravado: o da página ao abrir, e o que a pessoa acabou de salvar (a página não recarrega depois do "salvar"). Sem isto,
   * trocar, salvar e voltar ao ramo de antes comparava com o de ANTES de salvar e não mandava nada: a tela dizia "salvo" com o ramo errado
   * gravado (achado da revisão independente da E45 PR 1).
   */
  const [ramoSalvo, setRamoSalvo] = useState<string | null>(ramoInicial?.slug ?? null);
  /**
   * "Não achei o meu" (E45 PR 2): o pedido de ramo aberto da marca (o que a página trouxe, e o que a última gravação devolveu), o modo em que o
   * campo mostra "Não achei o meu" com o texto livre, e o texto. Com pedido aberto a página abre já nesse modo (o ramo do catálogo que ela mostrava
   * era o provisório, não uma escolha da pessoa).
   */
  const [pedidoDeRamo, setPedidoDeRamo] = useState<PedidoDeRamoNaTela | null>(pedidoDeRamoInicial);
  const [modoOutro, setModoOutro] = useState(pedidoDeRamoInicial !== null);
  const [ramoOutro, setRamoOutro] = useState(pedidoDeRamoInicial?.texto ?? "");
  // Com pedido aberto a marca está no ramo provisório, que não foi escolha da pessoa: escolher da lista (até o próprio provisório) vale como escolha e fecha o pedido.
  const ramoMudou = !modoOutro && ramo !== null && (ramo !== ramoSalvo || pedidoDeRamo !== null);
  /** O texto livre só vai ao servidor se a pessoa o escreveu de novo (ou o escreveu pela primeira vez): salvar sem mexer não refaz o palpite. */
  const outroMudou = modoOutro && ramoOutro.trim().length > 0 && normalizarBusca(ramoOutro) !== normalizarBusca(pedidoDeRamo?.texto ?? "");
  const avisoDoPedido = pedidoDeRamo
    ? pedidoDeRamo.limiteDeRamosNovos
      ? ramoInicial
        ? textosRamo.limiteNoRamoDeHoje(ramoInicial.nome)
        : textosRamo.limiteSemTemas
      : pedidoDeRamo.ramoProvisorio
      ? textosRamo.provisorio(pedidoDeRamo.ramoProvisorio)
      : ramoInicial
        ? textosRamo.aguardandoNoRamoDeHoje(ramoInicial.nome)
        : textosRamo.aguardandoSemRamo
    : null;
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
    const siteMudou = siteNormalizado !== normalizarSite(siteSalvo);
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
    if (modoOutro && ramoOutro.trim().length === 0) {
      setErro(textosBriefing.dadosFixos.ramoObrigatorio);
      return;
    }
    setSalvando(true);
    try {
      const resultado = await salvarContaAction({
        nome,
        perfis: { instagram, tiktok, youtube },
        ...(siteMudou ? { site: siteNormalizado } : {}),
        ...(ramoMudou ? { ramo } : {}),
        ...(outroMudou ? { ramoOutro: ramoOutro.trim() } : {}),
        tema,
        horaLembrete: horaArredondada,
        // `onde` sempre preenchido: o cliente já passou pelo Começar antes de chegar na Conta.
        ...(onde ? montarCampoOnde(onde, regiao.trim(), pais.trim(), paises.trim()) : {}),
      });
      // Um erro esperado (o teto de ramos novos do dia) volta como frase, e nada foi gravado: o formulário fica como a pessoa deixou.
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      avisarRedeOk();
      if (siteMudou) {
        setSite(siteNormalizado);
        setSiteSalvo(siteNormalizado);
      }
      if (ramoMudou) setRamoSalvo(ramo);
      // O pedido de ramo depois da gravação: `undefined` o ramo não mexeu; `null` o pedido fechou; objeto, o pedido aberto e o provisório.
      if (resultado.dado.pedidoDeRamo !== undefined) {
        setPedidoDeRamo(resultado.dado.pedidoDeRamo);
        if (resultado.dado.pedidoDeRamo === null) setModoOutro(false);
        // O ramo gravado acompanha o servidor: o provisório do palpite (nulo se nada casou e a marca ficou onde estava).
        else if (resultado.dado.pedidoDeRamo.ramoProvisorioSlug) setRamoSalvo(resultado.dado.pedidoDeRamo.ramoProvisorioSlug);
      }
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
          <BuscaDeRamo
            rotulo={textosConta.ramo.rotulo}
            ajuda={textosConta.ramo.ajuda}
            valor={modoOutro ? null : ramo}
            nomeForaDoCatalogo={modoOutro ? textosBriefing.dadosFixos.naoAchei : ramoInicial && !ramoInicial.slug ? ramoInicial.nome : null}
            textoNaoAchei={textosBriefing.dadosFixos.naoAchei}
            onEscolher={(slug) => {
              setRamo(slug);
              setModoOutro(false);
            }}
            onNaoAchei={(digitado) => {
              // O que a pessoa acabou de digitar na busca vira o texto livre; sem nada digitado, o texto de antes fica.
              if (digitado) setRamoOutro(digitado);
              setModoOutro(true);
            }}
          />
          {modoOutro ? (
            <Campo
              rotulo={textosConta.ramo.campoOutro}
              ajuda={textosConta.ramo.ajudaOutro}
              value={ramoOutro}
              onChange={(e) => setRamoOutro(e.target.value)}
            />
          ) : null}
          {ramoMudou ? <p className={styles.subGrupo}>{textosConta.ramo.aviso}</p> : null}
          {ramosAlternativos.length > 0 ? (
            <p className={styles.subGrupo} data-ramos-alternativos-conta>
              {textosConta.ramo.alternativos(ramosAlternativos)}
            </p>
          ) : null}
          {modoOutro && avisoDoPedido ? (
            <p className={styles.subGrupo} data-aviso-ramo-provisorio>
              {avisoDoPedido}
            </p>
          ) : null}
        </div>

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
