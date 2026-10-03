/**
 * O catálogo de ramos (E45, aprovado pelo Gustavo em 02/10/2026, 21:55; a lista e as palavras vêm de `pesquisa/catalogo-de-ramos.md`).
 *
 * O ramo diz em que base de vídeos a marca entra (a chave de cache do motor); o que a pessoa é de fato (piloto, dentista de
 * implante, loja de adesivo) fica no briefing. 44 ramos em 9 grupos, nome curto de gente, uma linha de exemplos para a pessoa se
 * achar em dois segundos, e as palavras que ela escreveria (a busca instantânea casa por começo de palavra, sem acento e sem
 * maiúscula, no nome, nos exemplos e nestas palavras: `src/lib/buscar-ramo.ts`).
 *
 * O `slug` é a identidade estável do ramo (é o que `nichos.ramo_catalogo` guarda): o nome e as palavras podem ser reescritos
 * sem migração, o slug não. Ramo sem conta não custa nada: só é pesquisado quando a primeira marca entra nele.
 */

export type GrupoDeRamo = { slug: string; nome: string };

export type RamoDoCatalogo = {
  /** O número do catálogo aprovado (1 a 44), só para conferir contra o documento; a ordem da lista é a deste vetor. */
  numero: number;
  slug: string;
  grupo: string;
  nome: string;
  /** A linha de exemplos que a pessoa lê embaixo do nome. */
  exemplos: string;
  /** O que a pessoa escreveria para chegar aqui (além do nome e dos exemplos). */
  palavras: readonly string[];
};

export const GRUPOS_DE_RAMO: readonly GrupoDeRamo[] = [
  { slug: "casa-e-limpeza", nome: "Casa e limpeza" },
  { slug: "automotivo", nome: "Automotivo" },
  { slug: "saude", nome: "Saúde" },
  { slug: "beleza-e-estetica", nome: "Beleza e estética" },
  { slug: "corpo-e-esporte", nome: "Corpo e esporte" },
  { slug: "comida-e-bebida", nome: "Comida e bebida" },
  { slug: "moda-e-varejo", nome: "Moda e varejo" },
  { slug: "servicos-e-profissoes", nome: "Serviços e profissões" },
  { slug: "perfil-pessoal", nome: "Perfil pessoal" },
];

function ramo(numero: number, slug: string, grupo: string, nome: string, exemplos: string, palavras: string): RamoDoCatalogo {
  return { numero, slug, grupo, nome, exemplos, palavras: palavras.split(", ") };
}

export const RAMOS_DO_CATALOGO: readonly RamoDoCatalogo[] = [
  // Casa e limpeza
  ramo(1, "limpeza-e-organizacao-da-casa", "casa-e-limpeza", "Limpeza e organização da casa", "Produtos de limpeza, diarista, organização, lavanderia.", "diarista, faxina, limpeza, organizadora, lavanderia, passadoria, produto de limpeza"),
  ramo(2, "reforma-e-construcao", "casa-e-limpeza", "Reforma e construção", "Pedreiro, pintor, marcenaria, elétrica, hidráulica, material de construção.", "pedreiro, pintor, marceneiro, eletricista, encanador, reforma, obra, gesso, vidraçaria, serralheria"),
  ramo(3, "decoracao-e-moveis", "casa-e-limpeza", "Decoração e móveis", "Arquitetura de interiores, móveis planejados, loja de decoração.", "arquiteta, designer de interiores, móveis, planejados, decoração, cortina, tapete"),
  ramo(4, "jardim-e-paisagismo", "casa-e-limpeza", "Jardim e paisagismo", "Jardinagem, plantas, piscina.", "jardineiro, paisagismo, plantas, piscina, grama"),
  ramo(5, "imoveis", "casa-e-limpeza", "Imóveis", "Corretor, imobiliária, aluguel por temporada.", "corretor, imobiliária, apartamento, aluguel, temporada, airbnb"),

  // Automotivo
  ramo(6, "estetica-automotiva", "automotivo", "Estética automotiva", "Envelopamento, película, polimento, lavagem, PPF.", "envelopamento, película, insulfilm, polimento, lavagem, estética automotiva, ppf, vitrificação, adesivo"),
  ramo(7, "oficina-e-pecas", "automotivo", "Oficina e peças", "Mecânica, funilaria, autopeças, som e acessórios.", "mecânico, oficina, funilaria, autopeças, pneu, som automotivo, elétrica automotiva"),
  ramo(8, "compra-e-venda-de-veiculos", "automotivo", "Compra e venda de veículos", "Loja de carros e motos, consórcio.", "revenda, loja de carros, seminovos, moto, consórcio"),
  ramo(9, "automobilismo-e-pilotagem", "automotivo", "Automobilismo e pilotagem", "Piloto, kart, track day, equipe de corrida.", "piloto, kart, corrida, automobilismo, track day, equipe"),

  // Saúde
  ramo(10, "odontologia", "saude", "Odontologia", "Clínica, dentista, ortodontia, estética dental.", "dentista, odontologia, clínica odontológica, ortodontia, implante, clareamento, aparelho"),
  ramo(11, "medicina-e-clinicas", "saude", "Medicina e clínicas", "Médico, clínica, exames.", "médico, clínica, dermatologista, ginecologista, pediatra, exames, laboratório"),
  ramo(12, "nutricao", "saude", "Nutrição", "Nutricionista, emagrecimento, alimentação.", "nutricionista, nutrição, dieta, emagrecimento"),
  ramo(13, "psicologia-e-terapias", "saude", "Psicologia e terapias", "Psicólogo, terapeuta, saúde mental.", "psicólogo, psicóloga, terapia, terapeuta, ansiedade"),
  ramo(14, "fisioterapia-e-pilates", "saude", "Fisioterapia e pilates", "Fisioterapeuta, estúdio de pilates, quiropraxia.", "fisioterapeuta, pilates, quiropraxia, rpg, osteopatia"),
  ramo(15, "veterinaria-e-pet", "saude", "Veterinária e pet", "Clínica veterinária, pet shop, banho e tosa, adestramento.", "veterinário, pet shop, banho e tosa, adestrador, cachorro, gato"),

  // Beleza e estética
  ramo(16, "cabelo-e-barbearia", "beleza-e-estetica", "Cabelo e barbearia", "Salão, cabeleireiro, barbeiro.", "cabeleireiro, salão, barbearia, barbeiro, mega hair, colorista"),
  ramo(17, "estetica-e-pele", "beleza-e-estetica", "Estética e pele", "Clínica de estética, harmonização, depilação, micropigmentação.", "estética, esteticista, harmonização, botox, depilação, laser, micropigmentação, limpeza de pele"),
  ramo(18, "unhas-cilios-e-sobrancelha", "beleza-e-estetica", "Unhas, cílios e sobrancelha", "Manicure, extensão de cílios, design de sobrancelha.", "manicure, unhas, alongamento, cílios, lash, sobrancelha, designer"),
  ramo(19, "maquiagem-e-cosmeticos", "beleza-e-estetica", "Maquiagem e cosméticos", "Maquiador, loja e marca de cosméticos.", "maquiadora, maquiagem, cosméticos, perfume, skincare"),

  // Corpo e esporte
  ramo(20, "academia-e-treino", "corpo-e-esporte", "Academia e treino", "Personal, academia, crossfit, treino em casa.", "personal, academia, treino, crossfit, musculação"),
  ramo(21, "esportes-e-lutas", "corpo-e-esporte", "Esportes e lutas", "Escola de futebol, jiu-jitsu, corrida, natação.", "futebol, jiu-jitsu, luta, corrida, natação, tênis, escolinha"),
  ramo(22, "danca-e-ioga", "corpo-e-esporte", "Dança e ioga", "Estúdio de dança, ioga, meditação.", "dança, ballet, ioga, yoga, meditação"),

  // Comida e bebida
  ramo(23, "restaurante-e-lanchonete", "comida-e-bebida", "Restaurante e lanchonete", "Restaurante, hamburgueria, pizzaria, delivery.", "restaurante, lanchonete, hamburgueria, pizzaria, delivery, marmita, comida"),
  ramo(24, "confeitaria-e-padaria", "comida-e-bebida", "Confeitaria e padaria", "Bolos, doces, salgados, pães.", "confeitaria, bolo, doces, salgados, padaria, brigadeiro"),
  ramo(25, "bar-cafe-e-bebidas", "comida-e-bebida", "Bar, café e bebidas", "Cafeteria, bar, cervejaria, adega.", "café, cafeteria, bar, cerveja, adega, vinho, drinks"),
  ramo(26, "alimentos-e-mercado", "comida-e-bebida", "Alimentos e mercado", "Mercearia, hortifruti, açougue, produto alimentício de marca própria.", "mercado, mercearia, hortifruti, açougue, empório, suplementos, alimento"),

  // Moda e varejo
  ramo(27, "moda-e-vestuario", "moda-e-varejo", "Moda e vestuário", "Loja de roupa, marca própria, brechó, moda íntima, calçados.", "roupa, loja de roupa, moda, brechó, lingerie, calçados, sapato"),
  ramo(28, "joias-oculos-e-acessorios", "moda-e-varejo", "Joias, óculos e acessórios", "Joalheria, semijoias, ótica, bolsas.", "joia, semijoia, ótica, óculos, relógio, bolsa"),
  ramo(29, "infantil-e-brinquedos", "moda-e-varejo", "Infantil e brinquedos", "Loja infantil, brinquedos, enxoval.", "infantil, bebê, brinquedo, enxoval, criança"),
  ramo(30, "loja-e-comercio-em-geral", "moda-e-varejo", "Loja e comércio em geral", "Papelaria, presentes, utilidades, eletrônicos, celular e assistência.", "loja, papelaria, presentes, utilidades, celular, assistência técnica, eletrônicos"),
  ramo(31, "artesanato-e-feito-a-mao", "moda-e-varejo", "Artesanato e feito à mão", "Ateliê, costura, personalizados, velas, cerâmica.", "artesanato, ateliê, costura, crochê, personalizados, vela, cerâmica"),

  // Serviços e profissões
  ramo(32, "advocacia", "servicos-e-profissoes", "Advocacia", "Advogado, escritório, direito do consumidor, família, trabalhista.", "advogado, advogada, advocacia, direito, escritório de advocacia"),
  ramo(33, "contabilidade-e-financas", "servicos-e-profissoes", "Contabilidade e finanças", "Contador, consultor financeiro, seguros, crédito.", "contador, contabilidade, financeiro, seguros, crédito, investimentos"),
  ramo(34, "educacao-e-cursos", "servicos-e-profissoes", "Educação e cursos", "Escola, professor particular, idiomas, curso profissionalizante.", "escola, professor, aula, curso, inglês, idiomas, concurso, reforço"),
  ramo(35, "fotografia-e-video", "servicos-e-profissoes", "Fotografia e vídeo", "Fotógrafo, filmagem, estúdio.", "fotógrafo, fotografia, filmagem, vídeo, estúdio"),
  ramo(36, "eventos-e-festas", "servicos-e-profissoes", "Eventos e festas", "Buffet, decoração de festa, cerimonial, DJ, casamento.", "festa, evento, buffet, casamento, cerimonial, dj, decoração de festa"),
  ramo(37, "turismo-e-hospedagem", "servicos-e-profissoes", "Turismo e hospedagem", "Agência de viagem, pousada, guia, passeios.", "viagem, turismo, agência, pousada, hotel, guia, passeio"),
  ramo(38, "tecnologia-e-automacao", "servicos-e-profissoes", "Tecnologia e automação", "Informática, sistemas, automação residencial, energia solar, segurança eletrônica.", "tecnologia, informática, sistema, software, automação, energia solar, câmera, segurança"),
  ramo(39, "marketing-e-design", "servicos-e-profissoes", "Marketing e design", "Agência, social media, designer, gráfica.", "marketing, agência, social media, designer, gráfica, tráfego"),
  ramo(40, "agro-e-campo", "servicos-e-profissoes", "Agro e campo", "Produtor rural, máquinas, insumos, pecuária.", "agro, fazenda, produtor rural, gado, soja, máquinas agrícolas, apicultura, abelha"),

  // Perfil pessoal (quem é a marca)
  ramo(41, "empreendedorismo-e-negocios", "perfil-pessoal", "Empreendedorismo e negócios", "Dono de empresa contando como constrói e decide.", "empreendedor, empresário, negócios, empreendedorismo, marca pessoal"),
  ramo(42, "carreira-e-desenvolvimento-pessoal", "perfil-pessoal", "Carreira e desenvolvimento pessoal", "Liderança, produtividade, vendas, comunicação.", "carreira, liderança, produtividade, vendas, comunicação, mentoria"),
  ramo(43, "viagem-e-estilo-de-vida", "perfil-pessoal", "Viagem e estilo de vida", "Viagens, morar fora, rotina, família.", "viagem, morar fora, estilo de vida, rotina, família, lifestyle"),
  ramo(44, "importacao-e-desenvolvimento-de-produto", "perfil-pessoal", "Importação e desenvolvimento de produto", "Fábrica, fornecedor, marca própria, comércio exterior.", "importação, fábrica, china, fornecedor, marca própria, produto"),
];

export const SLUGS_DE_RAMO: ReadonlySet<string> = new Set(RAMOS_DO_CATALOGO.map((r) => r.slug));

export function ramoPorSlug(slug: string | null | undefined): RamoDoCatalogo | null {
  if (!slug) return null;
  return RAMOS_DO_CATALOGO.find((r) => r.slug === slug) ?? null;
}

export function grupoDoRamo(ramoDoCatalogo: RamoDoCatalogo): GrupoDeRamo {
  const grupo = GRUPOS_DE_RAMO.find((g) => g.slug === ramoDoCatalogo.grupo);
  if (!grupo) throw new Error(`ramo "${ramoDoCatalogo.slug}" aponta para um grupo que nao existe: "${ramoDoCatalogo.grupo}"`);
  return grupo;
}
