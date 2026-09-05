/**
 * Dados de exemplo para desenvolvimento. Tudo aqui e ficticio (repositorio
 * publico, PROXIMO.md: nenhum dado real de cliente, briefing ou chave em
 * seed, teste ou fixture). Titulos de video comecam com "[exemplo]" e
 * `origem = "seed"`; toda consulta de produto filtra esses videos fora de
 * desenvolvimento (plataforma/CLAUDE.md).
 *
 * A senha abaixo e so para o ambiente local, nunca funciona em producao
 * porque o seed nunca roda la.
 */
import { hashPassword } from "better-auth/crypto";

import type { Db } from "../src/db";
import {
  account,
  briefings,
  clientes,
  contas,
  nichos,
  user,
  videos,
  type AnaliseVideo,
  type Plataforma,
  type PerfilCompilado,
} from "../src/db/schema";

const SENHA_DEV = "ExemploSenha123";

type NichoSeed = {
  slug: string;
  nome: string;
  termos: string[];
};

const NICHOS_SEED: NichoSeed[] = [
  {
    slug: "dentistas",
    nome: "Dentistas",
    termos: [
      "dentista",
      "clareamento",
      "implante",
      "aparelho",
      "canal",
      "lente de contato dental",
      "dor de dente",
      "ortodontia",
    ],
  },
  {
    slug: "limpeza-e-organizacao-da-casa",
    nome: "Limpeza e organização da casa",
    termos: [
      "produtos de limpeza",
      "limpeza pesada",
      "organização",
      "tira manchas",
      "faxina",
      "cheirinho de casa limpa",
    ],
  },
];

const TITULOS_POR_NICHO: Record<string, string[]> = {
  dentistas: [
    "como clarear os dentes em casa",
    "o que ninguem te conta sobre aparelho",
    "dor de dente nunca mais",
    "implante dentario, vale a pena",
    "antes e depois do clareamento",
    "rotina de limpeza no consultorio",
    "mito ou verdade sobre canal",
    "escolhendo a lente de contato dental",
    "ortodontia invisivel funciona",
    "paciente reagindo ao resultado",
  ],
  "limpeza-e-organizacao-da-casa": [
    "o produto que tira qualquer mancha",
    "faxina de 15 minutos por comodo",
    "como deixar a casa cheirosa por dias",
    "organizando o armario da cozinha",
    "limpeza pesada do banheiro sem esforco",
    "erro que todo mundo comete ao limpar",
    "antes e depois da organização da despensa",
    "produto de limpeza caseiro que funciona",
    "rotina de limpeza da semana",
    "testando produto de limpeza pesada",
  ],
};

const FORMATOS: AnaliseVideo["formato"][] = [
  "fala_para_camera",
  "podcast",
  "caixinha",
  "esquete",
  "outro",
];

const PLATAFORMAS: Plataforma[] = ["youtube", "tiktok", "instagram"];

type ResumoSeed = {
  nichos: number;
  contas: number;
  clientes: number;
  videos: number;
};

async function criarUsuarioComSenha(
  db: Db,
  dados: { id: string; nome: string; email: string; role: "admin" | "cliente" },
): Promise<void> {
  await db.insert(user).values({
    id: dados.id,
    name: dados.nome,
    email: dados.email,
    emailVerified: true,
    role: dados.role,
  });
  await db.insert(account).values({
    id: `${dados.id}-credential`,
    issuer: "local:credential",
    accountId: dados.id,
    providerId: "credential",
    userId: dados.id,
    password: await hashPassword(SENHA_DEV),
  });
}

function gerarVideos(
  nichoId: number,
  nichoSlug: string,
  contasDoNicho: { id: number; medianaViews: number }[],
): (typeof videos.$inferInsert)[] {
  const titulos = TITULOS_POR_NICHO[nichoSlug];
  const agora = Date.now();

  return Array.from({ length: 30 }, (_, i) => {
    const titulo = titulos[i % titulos.length];
    const conta = contasDoNicho[i % contasDoNicho.length];
    const plataforma = PLATAFORMAS[i % PLATAFORMAS.length];
    const diasAtras = 1 + (i % 60);
    const publicadoEm = new Date(agora - diasAtras * 24 * 60 * 60 * 1000);
    const views = Math.round(conta.medianaViews * (0.3 + (i % 10) * 0.35));
    const horasDesdePostagem = diasAtras * 24;

    const analise: AnaliseVideo = {
      assunto: titulo,
      gancho: "os 3 primeiros segundos mostram o resultado antes de explicar",
      estrutura: "gancho, explicacao curta, demonstracao, fechamento",
      fechamento: "resumo do que foi mostrado",
      chamadaFinal: "comenta se voce ja passou por isso",
      formato: FORMATOS[i % FORMATOS.length],
      porQueFuncionou: "mostra o problema real acontecendo, nao so fala sobre ele",
    };

    return {
      plataforma,
      idExterno: `seed-${nichoSlug}-${plataforma}-${i + 1}`,
      url: `https://exemplo.invalid/${plataforma}/seed-${nichoSlug}-${i + 1}`,
      contaId: conta.id,
      nichoId,
      titulo: `[exemplo] ${titulo}`,
      descricao: `[exemplo] video ficticio de desenvolvimento sobre ${titulo}.`,
      publicadoEm,
      duracaoS: 20 + (i % 6) * 10,
      views,
      likes: Math.round(views * 0.04),
      comentarios: Math.round(views * 0.006),
      foraDaCurva: (views / conta.medianaViews).toFixed(3),
      velocidade: (views / horasDesdePostagem).toFixed(3),
      transcricao: `[exemplo] transcricao ficticia. hoje eu vou falar sobre ${titulo}, um assunto que aparece muito por aqui.`,
      analise,
      etiquetas: [nichoSlug, analise.formato],
      origem: "seed" as const,
    };
  });
}

export async function semear(db: Db): Promise<ResumoSeed> {
  await criarUsuarioComSenha(db, {
    id: "seed-admin",
    nome: "[exemplo] Administrador",
    email: "admin@exemplo.teste",
    role: "admin",
  });

  const nichosCriados = await db.insert(nichos).values(NICHOS_SEED).returning();

  let totalContas = 0;
  let totalVideos = 0;
  let totalClientes = 0;

  const clientesPorNicho: Record<
    string,
    {
      usuarioId: string;
      nome: string;
      cidade: string;
      bairro: string;
      perfil: string;
      quemGrava: "propria_pessoa" | "pessoa_e_equipe";
      perfilCompilado: PerfilCompilado;
    }
  > = {
    dentistas: {
      usuarioId: "seed-cliente-dentistas",
      nome: "[exemplo] Sorriso Novo",
      cidade: "São Paulo",
      bairro: "Pinheiros",
      perfil: "exemplo_sorriso_novo",
      quemGrava: "propria_pessoa",
      perfilCompilado: {
        fatos: {
          oQueVende: "consultas e tratamentos odontologicos, clareamento e ortodontia",
          preco: "consulta a partir de 150 reais, clareamento a partir de 400 reais",
          clienteIdeal: "familia da regiao, adultos que evitam o dentista por medo ou vergonha do sorriso",
          medos: ["medo de sentir dor", "vergonha do estado dos dentes", "medo de gastar e nao resolver"],
          frasesDaFala: [
            '"aqui a gente explica tudo antes de fazer"',
            '"voce nao sai daqui sem entender o proprio tratamento"',
          ],
          proibicoes: ["nunca prometer resultado antes de examinar o paciente"],
          cenasFilmaveis: ["consultorio", "cadeira de atendimento", "sorriso do paciente antes e depois"],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo:
          "Clinica odontologica de bairro, atende familia da regiao, forte em clareamento e ortodontia, fala direto sobre medo e vergonha do sorriso.",
        referencias: [],
      },
    },
    "limpeza-e-organizacao-da-casa": {
      usuarioId: "seed-cliente-limpeza",
      nome: "[exemplo] Casa em Ordem",
      cidade: "Curitiba",
      bairro: "Batel",
      perfil: "exemplo_casa_em_ordem",
      quemGrava: "pessoa_e_equipe",
      perfilCompilado: {
        fatos: {
          oQueVende: "produtos de limpeza multiuso e servico de organizacao de ambientes",
          preco: "kit de produtos a partir de 80 reais, visita de organizacao a partir de 250 reais",
          clienteIdeal: "quem mora em apartamento e nao tem tempo para organizar a casa sozinho",
          medos: ["medo de produto forte fazer mal para criança ou animal", "vergonha da casa bagunçada"],
          frasesDaFala: ['"a gente resolve sem produto que faz mal para ninguem em casa"'],
          proibicoes: ["nunca usar produto com cheiro forte demais nas demonstracoes"],
          cenasFilmaveis: ["cozinha", "sala antes e depois da organizacao", "produto sendo usado de verdade"],
          concorrentes: [],
          perfisAdmirados: [],
        },
        resumo:
          "Marca de produtos de limpeza e organizacao para quem mora em apartamento, fala direto sobre praticidade e seguranca para criança e animal.",
        referencias: [],
      },
    },
  };

  for (const nicho of nichosCriados) {
    const contasSeed = Array.from({ length: 4 }, (_, i) => ({
      plataforma: PLATAFORMAS[i % PLATAFORMAS.length],
      handle: `@exemplo_${nicho.slug.replace(/-/g, "_")}_${i + 1}`,
      nome: `[exemplo] conta ${i + 1} de ${nicho.nome}`,
      url: `https://exemplo.invalid/perfil/${nicho.slug}-${i + 1}`,
      seguidores: 1000 * (i + 1) ** 2,
      nichoId: nicho.id,
      vigiada: i === 0,
      medianaViews: String(500 * (i + 1) ** 2),
      taxaForaDaCurva: String((0.1 + i * 0.08).toFixed(4)),
    }));
    const contasCriadas = await db.insert(contas).values(contasSeed).returning();
    totalContas += contasCriadas.length;

    const clienteSeed = clientesPorNicho[nicho.slug];
    await criarUsuarioComSenha(db, {
      id: clienteSeed.usuarioId,
      nome: clienteSeed.nome,
      email: `${clienteSeed.usuarioId}@exemplo.teste`,
      role: "cliente",
    });
    const [clienteCriado] = await db
      .insert(clientes)
      .values({
        usuarioId: clienteSeed.usuarioId,
        nome: clienteSeed.nome,
        nichoId: nicho.id,
        cidade: clienteSeed.cidade,
        bairro: clienteSeed.bairro,
        persona: "negocio",
        perfis: { instagram: `@${clienteSeed.perfil}`, tiktok: null, youtube: null },
        quemGrava: clienteSeed.quemGrava,
      })
      .returning();
    totalClientes += 1;

    /**
     * Briefing ja compilado e completo (etapa 12, ajuste 3 da revisao da
     * parte 1): sem isso, `gerarRoteiro` recusa o cliente de seed com "o
     * briefing deste cliente ainda nao foi compilado", e nem `scripts/
     * capturas.ts` nem uma sessao testando /roteiros/[id] a mao conseguem
     * ver a tela sem inserir isso na unha toda vez.
     */
    await db.insert(briefings).values({
      clienteId: clienteCriado.id,
      completo: true,
      notaGeral: "8.5",
      perfil: clienteSeed.perfilCompilado,
    });

    const contasParaVideo = contasCriadas.map((c) => ({
      id: c.id,
      medianaViews: Number(c.medianaViews),
    }));
    const videosSeed = gerarVideos(nicho.id, nicho.slug, contasParaVideo);
    const videosCriados = await db.insert(videos).values(videosSeed).returning({ id: videos.id });
    totalVideos += videosCriados.length;
  }

  return {
    nichos: nichosCriados.length,
    contas: totalContas,
    clientes: totalClientes,
    videos: totalVideos,
  };
}
