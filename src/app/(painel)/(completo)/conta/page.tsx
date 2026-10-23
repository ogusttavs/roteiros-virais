import { redirect } from "next/navigation";

import { HORA_LEMBRETE_PADRAO } from "@/config/lembrete";
import { config } from "@/lib/config";
import { sessaoDoPainel } from "@/lib/ver-como";
import { assinaturasDaMarca, ehDonoDaMarca } from "@/servicos/assinatura";
import { situacaoDaAssinatura } from "@/servicos/assinatura-tela";
import { garantirBriefing } from "@/servicos/briefing";
import { clienteAtivoDoUsuario, dadosOndeIniciais, membrosDaMarca, preferenciasDoUsuario } from "@/servicos/clientes";
import { candidatasDaMarca, contaLigadaDaMarca, ehDonoDaMarca as ehDonoParaInstagram, ligacaoDisponivel } from "@/servicos/conta-conectada";
import { formatosDaMarcaComEstado } from "@/servicos/formatos";
import { pedidoAbertoDaMarca } from "@/servicos/pedidos-de-ramo";
import { ramoAtualDoCliente } from "@/servicos/ramos";
import { ramosAlternativosDaMarca } from "@/servicos/ramos-da-conta";
import { textosConta } from "@/textos/conta";
import { textosVerComo } from "@/textos/ver-como";

import { AvisoDeManha } from "./AvisoDeManha";
import { BotaoSair } from "./BotaoSair";
import { BriefingLinha } from "./BriefingLinha";
import { FormularioConta } from "./FormularioConta";
import { InformacoesDoAparelhoAdmin } from "./InformacoesDoAparelhoAdmin";
import { InstalarNoCelular } from "./InstalarNoCelular";
import styles from "./page.module.css";
import { QuemTemAcesso } from "./QuemTemAcesso";
import { codigoDoRetorno, montarVisaoSeuInstagram } from "./seu-instagram-visao";
import { SeuInstagram } from "./SeuInstagram";
import { SuaAssinatura } from "./SuaAssinatura";
import { TiposDeVideoConta } from "./TiposDeVideoConta";
import { TrocarSenha } from "./TrocarSenha";

export default async function Conta({ searchParams }: { searchParams: Promise<{ instagram?: string | string[] }> }) {
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    redirect("/entrar");
  }

  const [cliente, preferencias] = await Promise.all([
    clienteAtivoDoUsuario(sessao.user.id),
    preferenciasDoUsuario(sessao.user.id),
  ]);
  const perfis = cliente?.perfis;
  // `dadosOndeIniciais`, não a coluna do cliente direto (nota em `servicos/clientes.ts`,
  // `dadosOndeIniciais`: o nome dela é jargão e o `checar-texto` reprova qualquer `.tsx` que o escreva).
  const onde = cliente ? dadosOndeIniciais(cliente) : null;
  const membros = cliente ? await membrosDaMarca(cliente.id) : [];
  const briefing = cliente ? await garantirBriefing(cliente.id) : null;
  const ramoAtual = await ramoAtualDoCliente(cliente?.nichoId);
  const pedidoAberto = cliente ? await pedidoAbertoDaMarca(cliente.id) : null;
  const alternativos = cliente ? await ramosAlternativosDaMarca(cliente.id) : [];
  const tiposDaMarca = cliente ? await formatosDaMarcaComEstado(cliente.id) : [];
  const notaBriefing = briefing?.notaGeral ? Number(briefing.notaGeral) : null;
  // E22 PR 2: o cartão "Sua assinatura" só aparece com a cobrança ligada ou com assinatura no histórico da marca (desligada e sem assinatura, Conta fica como sempre foi).
  const assinaturasDaConta = cliente ? await assinaturasDaMarca(cliente.id) : [];
  const mostrarAssinatura = cliente !== null && (config.cobranca.ativa || assinaturasDaConta.length > 0);
  const situacaoAssinatura = cliente ? situacaoDaAssinatura(cliente.cortesia, assinaturasDaConta) : null;
  const donoDaMarca = mostrarAssinatura && cliente && !sessao.verComo ? await ehDonoDaMarca(sessao.user.id, cliente.id) : false;
  // E19 PR 2: o cartão "Seu Instagram". Só a dona da marca (fora do "ver como") vê os botões; a frase da volta do diálogo da Meta vem em `?instagram=<código>`.
  const donoDoInstagram = cliente ? await ehDonoParaInstagram(sessao.user.id, cliente.id) : false;
  const visaoInstagram = cliente
    ? montarVisaoSeuInstagram({
        ligacaoAberta: ligacaoDisponivel(),
        aprovadoPelaMeta: config.metaConexao.aprovadoPelaMeta,
        dono: donoDoInstagram,
        verComo: sessao.verComo !== null,
        conta: await contaLigadaDaMarca(cliente.id),
        candidatas: await candidatasDaMarca(cliente.id),
        retorno: codigoDoRetorno((await searchParams).instagram),
      })
    : null;

  return (
    <div className={styles.pagina}>
      {/*
        V15, item 6b (design v2, passo 8): "Quem tem acesso a esta marca" é o lado fixo a partir
        de 1024px, começando no alto; os dados, os perfis, o lembrete, o tema e o pé (instalar,
        informações do aparelho, sair) ficam na coluna. Mesma posição no DOM de sempre: nada muda
        abaixo de 1024px.
      */}
      <div className={styles.colunaPrincipal}>
        {cliente ? <BriefingLinha nota={notaBriefing} /> : null}
        {cliente ? <TiposDeVideoConta iniciais={tiposDaMarca.map((t) => ({ chave: t.chave, ligada: t.ligada }))} /> : null}
        <h1 className={styles.titulo}>{textosConta.titulo}</h1>
        <FormularioConta
          nomeInicial={sessao.user.name}
          email={sessao.user.email}
          instagramInicial={perfis?.instagram ?? ""}
          tiktokInicial={perfis?.tiktok ?? ""}
          youtubeInicial={perfis?.youtube ?? ""}
          siteInicial={cliente?.site ?? ""}
          temaInicial={cliente?.tema ?? "sistema"}
          horaLembreteInicial={preferencias?.horaLembrete ?? HORA_LEMBRETE_PADRAO}
          nomeMarca={cliente?.nome ?? ""}
          tipo={cliente?.tipo ?? "negocio"}
          ramoInicial={ramoAtual ? { slug: ramoAtual.ramoSlug, nome: ramoAtual.nome } : null}
          ramosAlternativos={alternativos.map((a) => a.nome)}
          pedidoDeRamo={
            pedidoAberto
              ? {
                  texto: pedidoAberto.texto,
                  // O ramo provisório só vale enquanto a marca está nele (se ela saiu por outro caminho, a frase não o cita).
                  ramoProvisorio:
                    pedidoAberto.setorProvisorioId !== null && pedidoAberto.setorProvisorioId === cliente?.nichoId ? (ramoAtual?.nome ?? null) : null,
                  ramoProvisorioSlug:
                    pedidoAberto.setorProvisorioId !== null && pedidoAberto.setorProvisorioId === cliente?.nichoId ? (ramoAtual?.ramoSlug ?? null) : null,
                }
              : null
          }
          ondeInicial={onde?.onde ?? null}
          regiaoInicial={onde?.regiao ?? null}
          paisInicial={onde?.pais ?? null}
          paisesInicial={onde?.paises ?? null}
          desligadoVerComo={sessao.verComo ? textosVerComo.contaSalvarDesligado(sessao.user.name) : undefined}
        />
      </div>
      {cliente ? (
        <QuemTemAcesso nomeMarca={cliente.nome} membros={membros} usuarioIdAtual={sessao.user.id} />
      ) : null}
      <div className={styles.colunaPrincipal}>
        {mostrarAssinatura && situacaoAssinatura ? <SuaAssinatura situacao={situacaoAssinatura} dono={donoDaMarca} verComo={sessao.verComo !== null} /> : null}
        {visaoInstagram ? <SeuInstagram visao={visaoInstagram} /> : null}
        {/* E46 PR 2: no "ver como" nada que inscreve, instala ou sai em nome da pessoa aparece (o aviso de manhã, o convite de instalar e o Sair são do aparelho e da sessão de quem está olhando). */}
        {/* E58: a senha é de quem está logado; no "ver como" o admin olha e não troca a senha de ninguém. */}
        {sessao.verComo ? null : <TrocarSenha />}
        {sessao.verComo ? null : <InstalarNoCelular />}
        {sessao.verComo ? null : <AvisoDeManha chavePublica={config.push.publicKey} horaLembrete={preferencias?.horaLembrete ?? HORA_LEMBRETE_PADRAO} ehAdmin={sessao.user.role === "admin"} />}
        <InformacoesDoAparelhoAdmin ehAdmin={sessao.user.role === "admin"} versaoPainel={config.gitSha} />
        {sessao.verComo ? null : <BotaoSair />}
      </div>
    </div>
  );
}
