import { redirect } from "next/navigation";

import { HORA_LEMBRETE_PADRAO } from "@/config/lembrete";
import { config } from "@/lib/config";
import { sessaoDoPainel } from "@/lib/ver-como";
import { garantirBriefing } from "@/servicos/briefing";
import { clienteAtivoDoUsuario, dadosOndeIniciais, membrosDaMarca, preferenciasDoUsuario } from "@/servicos/clientes";
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
import { TiposDeVideoConta } from "./TiposDeVideoConta";

export default async function Conta() {
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
        {/* E46 PR 2: no "ver como" nada que inscreve, instala ou sai em nome da pessoa aparece (o aviso de manhã, o convite de instalar e o Sair são do aparelho e da sessão de quem está olhando). */}
        {sessao.verComo ? null : <InstalarNoCelular />}
        {sessao.verComo ? null : <AvisoDeManha chavePublica={config.push.publicKey} horaLembrete={preferencias?.horaLembrete ?? HORA_LEMBRETE_PADRAO} ehAdmin={sessao.user.role === "admin"} />}
        <InformacoesDoAparelhoAdmin ehAdmin={sessao.user.role === "admin"} versaoPainel={config.gitSha} />
        {sessao.verComo ? null : <BotaoSair />}
      </div>
    </div>
  );
}
