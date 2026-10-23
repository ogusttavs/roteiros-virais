/**
 * O catálogo de assuntos que a pessoa pode acompanhar nas Notícias ("Acompanhar um assunto" que sugere enquanto ela digita, pedido do Gustavo em 23/10/2026, melhoria da E53).
 *
 * É a mesma ideia do catálogo de ramos (`ramos.ts`): uma lista curada de assuntos comuns, cada um com o nome que a pessoa lê e as palavras de busca já prontas, para ela não precisar
 * saber o que escrever. A busca em `src/lib/buscar-assunto.ts` casa por começo de palavra, sem acento e sem maiúscula, no nome, nas palavras e nos sinônimos. Escolher um assunto
 * preenche o nome e as palavras na folha dos assuntos; a pessoa ainda pode mexer em tudo.
 *
 * Regras desta lista:
 *  - O assunto sai das notícias dos veículos, por palavra inteira (`casaComAssunto`): "eleição" não casa com "eleições", então o plural e a sigla entram como palavras à parte.
 *  - Cada assunto tem de 3 a 6 palavras (a folha aceita até 7, e o nome do assunto também conta), cada uma com até 40 letras.
 *  - Pessoa pública entra pelo PAPEL (presidente, governadores, ministros), nunca pelo nome: o nome muda a cada eleição, e a lista ficaria errada. Quem quiser acompanhar uma pessoa
 *    específica digita o nome e usa "sugerir palavras". Assunto de política pode ser acompanhado; o roteiro continua sem tomar lado (regra do roteiro, não desta lista).
 *  - Nada de marca do produto e nada de jargão: quem lê é dono de pequeno negócio.
 */

export type GrupoDeAssunto = { slug: string; nome: string };

export type AssuntoDoCatalogo = {
  slug: string;
  grupo: string;
  /** O nome que a pessoa lê e que vira o assunto dela (até 60 letras). */
  nome: string;
  /** As palavras de busca já prontas: o que a coleta procura nas notícias. */
  palavras: readonly string[];
  /** O que a pessoa escreveria para chegar aqui, além do nome e das palavras (só para a busca, nunca vai para o assunto). */
  tambem: readonly string[];
};

export const GRUPOS_DE_ASSUNTO: readonly GrupoDeAssunto[] = [
  { slug: "economia-e-negocios", nome: "Economia e negócios" },
  { slug: "marketing-e-redes", nome: "Marketing e redes sociais" },
  { slug: "tecnologia-e-ia", nome: "Tecnologia e inteligência artificial" },
  { slug: "politica-e-eleicoes", nome: "Política e eleições" },
  { slug: "pessoas-publicas", nome: "Pessoas públicas, pelo papel" },
  { slug: "esporte", nome: "Esporte" },
  { slug: "datas-de-venda", nome: "Datas e épocas de venda" },
  { slug: "do-seu-ramo", nome: "Ligados ao seu ramo" },
];

function assunto(slug: string, grupo: string, nome: string, palavras: string, tambem = ""): AssuntoDoCatalogo {
  return { slug, grupo, nome, palavras: palavras.split(", "), tambem: tambem === "" ? [] : tambem.split(", ") };
}

export const ASSUNTOS_DO_CATALOGO: readonly AssuntoDoCatalogo[] = [
  // Economia e negócios
  assunto("dolar-e-cambio", "economia-e-negocios", "Dólar e câmbio", "dólar, cotação do dólar, câmbio, real", "moeda, dolar hoje"),
  assunto("juros-e-selic", "economia-e-negocios", "Juros e Selic", "Selic, juros, Copom, Banco Central", "taxa de juros, taxa selic"),
  assunto("inflacao-e-precos", "economia-e-negocios", "Inflação e preços", "inflação, IPCA, custo de vida, preços", "carestia, preço subindo"),
  assunto("impostos-e-reforma-tributaria", "economia-e-negocios", "Impostos e reforma tributária", "reforma tributária, imposto de renda, impostos, Receita Federal", "tributos, leão, irpf"),
  assunto("mei-e-pequenas-empresas", "economia-e-negocios", "MEI e pequenas empresas", "MEI, microempreendedor, Simples Nacional, pequenas empresas, Sebrae", "pequeno negócio, cnpj"),
  assunto("credito-e-financiamento", "economia-e-negocios", "Crédito e financiamento", "crédito, financiamento, empréstimo, consignado, Desenrola", "dívidas, cartão de crédito"),
  assunto("pix-e-pagamentos", "economia-e-negocios", "Pix e pagamentos", "Pix, pagamento digital, maquininha, cartão", "pagamentos, transferência"),
  assunto("emprego-e-trabalho", "economia-e-negocios", "Emprego e mercado de trabalho", "emprego, desemprego, mercado de trabalho, CLT, salário mínimo", "vagas, carteira assinada, trabalhista"),
  assunto("bolsa-e-investimentos", "economia-e-negocios", "Bolsa e investimentos", "bolsa de valores, Ibovespa, investimentos, renda fixa, Tesouro Direto", "ações, investir, fundos"),
  assunto("criptomoedas", "economia-e-negocios", "Bitcoin e criptomoedas", "bitcoin, criptomoedas, cripto, Ethereum", "criptomoeda, blockchain"),
  assunto("startups-e-empreendedorismo", "economia-e-negocios", "Empreendedorismo e startups", "empreendedorismo, startups, abrir empresa, empreendedores", "empreender, negócio próprio, empresário"),
  assunto("varejo-e-consumo", "economia-e-negocios", "Varejo e consumo", "varejo, consumo, comércio, vendas do comércio, consumidor", "lojas, vendas"),
  assunto("importacao-e-comercio-exterior", "economia-e-negocios", "Importação e comércio exterior", "importação, exportação, taxa das blusinhas, tarifa, comércio exterior", "china, alfândega, tarifaço"),

  // Marketing e redes sociais
  assunto("algoritmo-do-instagram", "marketing-e-redes", "Instagram e Reels", "Instagram, Reels, algoritmo do Instagram, Meta", "stories, feed"),
  assunto("tiktok", "marketing-e-redes", "TikTok", "TikTok, TikTok Shop, algoritmo do TikTok", "tik tok, vídeos curtos"),
  assunto("youtube-e-shorts", "marketing-e-redes", "YouTube e Shorts", "YouTube, Shorts, monetização, criadores de vídeo", "canal, vídeos longos"),
  assunto("marketing-digital", "marketing-e-redes", "Marketing digital", "marketing digital, tráfego pago, anúncios, redes sociais", "propaganda, publicidade, ads"),
  assunto("influenciadores-e-criadores", "marketing-e-redes", "Influenciadores e criadores de vídeo", "influenciadores, influenciador digital, criadores de vídeo, publi", "creators, parcerias, digital influencer"),
  assunto("videos-que-viralizam", "marketing-e-redes", "Vídeos que bombam nas redes", "vídeo que bomba, bombou, trend, tendências das redes", "viral, viralizar, viralizou, fenômeno"),
  assunto("whatsapp-para-negocios", "marketing-e-redes", "WhatsApp para negócios", "WhatsApp, WhatsApp Business, atendimento no WhatsApp", "zap, mensagens, catálogo"),
  assunto("regras-das-redes", "marketing-e-redes", "Regras das redes e plataformas", "regras das redes sociais, moderação, regulação das redes, banimento", "bloqueio de conta, censura, lei das redes"),

  // Tecnologia e inteligência artificial
  assunto("inteligencia-artificial", "tecnologia-e-ia", "Inteligência artificial", "inteligência artificial, IA, ChatGPT, IA generativa", "robôs, openai, gemini, claude"),
  assunto("ia-no-trabalho", "tecnologia-e-ia", "IA no dia a dia do negócio", "ferramentas de IA, automação, IA para empresas, agentes de IA", "automatizar, produtividade com ia"),
  assunto("celulares-e-gadgets", "tecnologia-e-ia", "Celulares e gadgets", "celular, iPhone, Samsung, lançamento", "smartphone, tecnologia, aparelhos"),
  assunto("big-techs", "tecnologia-e-ia", "Big techs", "Google, Apple, Meta, Microsoft, Amazon", "grandes empresas de tecnologia, vale do silício"),
  assunto("golpes-e-seguranca-digital", "tecnologia-e-ia", "Golpes e segurança digital", "golpes, golpe digital, vazamento de dados, LGPD, hackers", "fraude, phishing, segurança"),

  // Política e eleições
  assunto("eleicoes", "politica-e-eleicoes", "Eleições", "eleição, eleições, candidatos, urna, pesquisa eleitoral", "voto, votação, campanha eleitoral, presidenciáveis"),
  assunto("governo-federal", "politica-e-eleicoes", "Governo federal", "governo federal, Planalto, ministros, medida provisória", "governo, brasília"),
  assunto("congresso-nacional", "politica-e-eleicoes", "Congresso Nacional", "Congresso, Câmara dos Deputados, Senado, votação", "projeto de lei, plenário"),
  assunto("stf-e-justica", "politica-e-eleicoes", "STF e Justiça", "STF, Supremo, ministros do STF, julgamento", "supremo tribunal federal, justiça, tribunal"),
  assunto("prefeituras-e-cidades", "politica-e-eleicoes", "Prefeituras e câmaras de vereadores", "prefeitura, prefeito, vereadores, câmara municipal", "cidade, política local, municipal"),
  assunto("seguranca-publica", "politica-e-eleicoes", "Segurança pública", "segurança pública, polícia, violência urbana, policiamento", "crime, assalto, delegacia"),
  assunto("politica-internacional", "politica-e-eleicoes", "Política internacional", "política internacional, Estados Unidos, Casa Branca, ONU, guerra", "geopolítica, eua, mundo"),

  // Pessoas públicas, pelo papel
  assunto("presidente-da-republica", "pessoas-publicas", "Presidente da República", "presidente da República, presidente, Planalto", "chefe de estado, presidência"),
  assunto("governadores", "pessoas-publicas", "Governadores", "governador, governadora, governadores, governo do estado", "governo estadual"),
  assunto("ministros-e-ministras", "pessoas-publicas", "Ministros e ministras", "ministro, ministra, ministros, ministério", "ministro da fazenda, ministra"),
  assunto("deputados-e-senadores", "pessoas-publicas", "Deputados e senadores", "deputado, deputada, senador, senadora, parlamentares", "congressista, parlamentar"),
  assunto("prefeitos-e-prefeitas", "pessoas-publicas", "Prefeitos e prefeitas", "prefeito, prefeita, prefeitos, prefeitos das capitais", "prefeitura"),
  assunto("candidatos-e-pre-candidatos", "pessoas-publicas", "Candidatos e pré-candidatos", "candidato, candidata, candidatos, pré-candidato, presidenciável", "presidenciáveis, concorrente"),
  assunto("empresarios-e-bilionarios", "pessoas-publicas", "Empresários e bilionários", "bilionário, bilionários, empresário, CEO, fundador", "milionário, dono de empresa, ceo"),
  assunto("celebridades-e-artistas", "pessoas-publicas", "Celebridades e artistas", "celebridades, famosos, cantores, atores, artistas", "fama, cantora, atriz"),
  assunto("jogadores-e-tecnicos", "pessoas-publicas", "Jogadores e técnicos de futebol", "jogador, jogadores, técnico, craque, transferência", "atleta, treinador, contratação"),

  // Esporte
  assunto("futebol-brasileiro", "esporte", "Futebol brasileiro", "futebol, Brasileirão, Copa do Brasil, Libertadores", "campeonato brasileiro, times, rodada"),
  assunto("selecao-brasileira", "esporte", "Seleção brasileira e Copa do Mundo", "seleção brasileira, técnico da seleção, convocação, Copa do Mundo", "seleção, mundial, eliminatórias"),
  assunto("formula-1-e-automobilismo", "esporte", "Fórmula 1 e automobilismo", "Fórmula 1, F1, automobilismo, Stock Car, piloto", "corrida de carro, grande prêmio"),
  assunto("olimpiadas", "esporte", "Olimpíadas e atletas brasileiros", "Olimpíadas, medalhas, atletas brasileiros, esporte olímpico", "jogos olímpicos, medalha"),
  assunto("mma-e-lutas", "esporte", "MMA e lutas", "UFC, MMA, boxe, jiu-jitsu", "luta, lutador, artes marciais"),
  assunto("volei-e-basquete", "esporte", "Vôlei e basquete", "vôlei, basquete, NBA, Superliga", "basketball, quadra"),

  // Datas e épocas de venda
  assunto("black-friday", "datas-de-venda", "Black Friday", "Black Friday, promoção, descontos, Cyber Monday", "sexta-feira negra, ofertas"),
  assunto("natal-e-fim-de-ano", "datas-de-venda", "Natal e fim de ano", "Natal, ceia de Natal, presentes de Natal, Réveillon", "ano novo, festas de fim de ano, 13º salário"),
  assunto("dia-das-maes", "datas-de-venda", "Dia das Mães", "Dia das Mães, presente de Dia das Mães, mães", "mamãe, presente para mãe"),
  assunto("dia-dos-namorados", "datas-de-venda", "Dia dos Namorados", "Dia dos Namorados, presente de Dia dos Namorados, namorados", "casais, 12 de junho"),
  assunto("dia-dos-pais", "datas-de-venda", "Dia dos Pais", "Dia dos Pais, presente de Dia dos Pais, pais", "papai, presente para pai"),
  assunto("dia-das-criancas", "datas-de-venda", "Dia das Crianças", "Dia das Crianças, brinquedos, crianças", "infantil, 12 de outubro"),
  assunto("pascoa", "datas-de-venda", "Páscoa", "Páscoa, ovo de Páscoa, chocolate, Semana Santa", "ovos de páscoa, feriado de páscoa"),
  assunto("carnaval", "datas-de-venda", "Carnaval", "Carnaval, blocos, folia, feriado de Carnaval", "bloco de rua, fantasia"),
  assunto("dia-do-consumidor", "datas-de-venda", "Dia do Consumidor", "Dia do Consumidor, promoções, Procon", "15 de março, direitos do consumidor"),
  assunto("volta-as-aulas", "datas-de-venda", "Volta às aulas", "volta às aulas, material escolar, lista de material, mensalidade escolar", "escola, início do ano letivo"),
  assunto("festas-juninas", "datas-de-venda", "Festas juninas", "festa junina, festas juninas, São João, quermesse", "arraial, junho"),
  assunto("dia-da-mulher", "datas-de-venda", "Dia da Mulher", "Dia da Mulher, mulheres empreendedoras, mulheres", "8 de março, empreendedorismo feminino"),

  // Ligados ao seu ramo
  assunto("saude-bucal", "do-seu-ramo", "Saúde bucal e odontologia", "odontologia, saúde bucal, dentista, plano odontológico", "dentes, implante, clareamento, aparelho"),
  assunto("sus-e-planos-de-saude", "do-seu-ramo", "SUS e planos de saúde", "SUS, plano de saúde, planos de saúde, ANS, Ministério da Saúde", "convênio, anvisa, hospital"),
  assunto("vacinas-e-campanhas", "do-seu-ramo", "Vacinas e campanhas de saúde", "vacina, vacinação, campanha de vacinação, imunização", "vacinas, gripe"),
  assunto("dengue-e-doencas", "do-seu-ramo", "Dengue e doenças da estação", "dengue, gripe, vírus, epidemia", "doença, surto, mosquito"),
  assunto("emagrecimento-e-canetas", "do-seu-ramo", "Emagrecimento e canetas emagrecedoras", "canetas emagrecedoras, Ozempic, emagrecimento, obesidade", "perder peso, mounjaro, dieta"),
  assunto("alimentacao-saudavel", "do-seu-ramo", "Alimentação saudável", "alimentação saudável, ultraprocessados, nutrição, dieta", "comida saudável, nutricionista"),
  assunto("suplementos-e-academia", "do-seu-ramo", "Suplementos e academia", "suplementos, whey, creatina, academia, musculação", "treino, fitness, personal"),
  assunto("saude-mental", "do-seu-ramo", "Saúde mental", "saúde mental, ansiedade, burnout, terapia, depressão", "psicologia, psicólogo, estresse"),
  assunto("beleza-e-estetica", "do-seu-ramo", "Beleza e estética", "estética, harmonização, botox, skincare, tendências de beleza", "cabelo, unhas, maquiagem, pele"),
  assunto("moda-e-tendencias", "do-seu-ramo", "Moda e tendências", "moda, tendências de moda, coleção, look, estilo", "roupas, lojas de roupa, brechó"),
  assunto("combustivel-e-petrobras", "do-seu-ramo", "Preço do combustível", "combustível, gasolina, preço da gasolina, etanol, Petrobras", "diesel, posto, bomba"),
  assunto("carros-eletricos", "do-seu-ramo", "Carros elétricos", "carro elétrico, carros elétricos, BYD, recarga", "elétricos, híbridos, mobilidade"),
  assunto("ipva-e-transito", "do-seu-ramo", "IPVA, CNH e trânsito", "IPVA, CNH, multas, Detran, trânsito", "carteira de motorista, licenciamento"),
  assunto("imoveis-e-financiamento", "do-seu-ramo", "Imóveis e financiamento", "imóveis, financiamento imobiliário, Minha Casa Minha Vida, aluguel", "casa própria, apartamento, corretor"),
  assunto("construcao-e-reformas", "do-seu-ramo", "Construção e reformas", "construção civil, material de construção, reforma, obras", "pedreiro, arquitetura, decoração"),
  assunto("energia-solar-e-conta-de-luz", "do-seu-ramo", "Energia solar e conta de luz", "energia solar, conta de luz, bandeira tarifária, tarifa de energia", "placa solar, energia elétrica"),
  assunto("delivery-e-restaurantes", "do-seu-ramo", "Delivery e restaurantes", "iFood, delivery, restaurantes, bares e restaurantes", "comida, lanchonete, gastronomia"),
  assunto("preco-dos-alimentos", "do-seu-ramo", "Preço dos alimentos", "preço dos alimentos, cesta básica, preço da carne, café", "mercado, supermercado, comida cara"),
  assunto("pets-e-veterinaria", "do-seu-ramo", "Pets e veterinária", "pets, cachorro, gato, veterinário, adoção de animais", "animais de estimação, pet shop"),
  assunto("turismo-e-viagens", "do-seu-ramo", "Turismo e viagens", "turismo, passagens aéreas, viagem, hotéis, feriado prolongado", "férias, pousada, aeroporto"),
  assunto("educacao-e-enem", "do-seu-ramo", "Educação e Enem", "Enem, vestibular, MEC, escola, educação", "faculdade, cursos, professor"),
  assunto("direitos-do-consumidor-e-do-trabalhador", "do-seu-ramo", "Direitos do consumidor e do trabalhador", "direito do consumidor, Procon, direitos trabalhistas, Justiça do Trabalho", "advogado, advocacia, direito"),
  assunto("agro-e-campo", "do-seu-ramo", "Agro e campo", "agronegócio, safra, soja, pecuária, preço do boi", "agricultura, fazenda, produtor rural"),
  assunto("clima-e-tempo", "do-seu-ramo", "Clima e previsão do tempo", "clima, previsão do tempo, chuvas, onda de calor, frio", "frente fria, temporal, el niño"),
  assunto("casamentos-e-eventos", "do-seu-ramo", "Casamentos e eventos", "casamento, eventos, festas, buffet", "cerimonial, noivas, formatura"),
  assunto("cinema-e-series", "do-seu-ramo", "Filmes e séries", "cinema, filmes, séries, streaming, Netflix", "lançamentos, estreia"),
  assunto("shows-e-musica", "do-seu-ramo", "Shows e música", "shows, música, festival, turnê, ingressos", "cantor, banda, evento musical"),
];

export function assuntoPorSlug(slug: string | null | undefined): AssuntoDoCatalogo | null {
  if (!slug) return null;
  return ASSUNTOS_DO_CATALOGO.find((a) => a.slug === slug) ?? null;
}

export function grupoDoAssunto(item: AssuntoDoCatalogo): GrupoDeAssunto {
  const grupo = GRUPOS_DE_ASSUNTO.find((g) => g.slug === item.grupo);
  if (!grupo) throw new Error(`assunto "${item.slug}" aponta para um grupo que nao existe: "${item.grupo}"`);
  return grupo;
}
