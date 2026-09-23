/**
 * Resolve uma referência de dia em texto livre ("segunda", "amanhã", "dia
 * 3", "hoje") para uma data ISO (`AAAA-MM-DD`), a partir de hoje (V9b, item
 * 1, "o plano colado"): por código, não pelo modelo, para nunca inventar um
 * dia que a pessoa não citou nem errar uma conta de calendário. A tarefa de
 * IA `lerAgenda` só separa o texto em dias e compromissos; quem resolve a
 * data de cada um é esta função.
 */
const DIAS_DA_SEMANA: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

export class ErroDataRelativa extends Error {}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function paraData(dataISO: string): Date {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function paraISO(data: Date): string {
  return data.toISOString().slice(0, 10);
}

function somarDias(dataISO: string, dias: number): string {
  const data = paraData(dataISO);
  data.setUTCDate(data.getUTCDate() + dias);
  return paraISO(data);
}

/**
 * `hoje` é a data de hoje já resolvida (`AAAA-MM-DD`, fuso do Brasil,
 * `src/lib/config.ts`, `hojeISO`). Entende: "hoje", "amanhã", os sete dias
 * da semana (o mesmo dia de hoje volta hoje, não a semana que vem: quem
 * planeja no domingo de manhã e escreve "domingo: embarque" quer dizer
 * hoje) e "dia N" (o dia N deste mês, ou do mês seguinte se esse dia já
 * passou; um N que não existe no mês candidato, como 31 de fevereiro, é
 * erro, nunca rola para o mês seguinte sozinho). Lança `ErroDataRelativa`
 * para o que não reconhece, para `lerAgenda` (quem chama) descartar o dia
 * em vez de inventar uma data.
 */
export function resolverDataRelativa(referencia: string, hoje: string): string {
  const texto = normalizar(referencia);

  if (texto === "hoje") return hoje;
  if (texto === "amanha") return somarDias(hoje, 1);

  if (texto in DIAS_DA_SEMANA) {
    const diaDeHoje = paraData(hoje).getUTCDay();
    const alvo = DIAS_DA_SEMANA[texto];
    const diferenca = (alvo - diaDeHoje + 7) % 7;
    return somarDias(hoje, diferenca);
  }

  const diaDoMes = texto.match(/^dia\s+(\d{1,2})$/);
  if (diaDoMes) {
    const numeroDia = Number(diaDoMes[1]);
    if (numeroDia < 1 || numeroDia > 31) {
      throw new ErroDataRelativa(`dia do mês inválido: "${referencia}"`);
    }
    const hojeData = paraData(hoje);
    const diaDeHoje = hojeData.getUTCDate();
    const mesCandidato = numeroDia >= diaDeHoje ? hojeData.getUTCMonth() : hojeData.getUTCMonth() + 1;
    const candidato = new Date(Date.UTC(hojeData.getUTCFullYear(), mesCandidato, numeroDia));
    if (candidato.getUTCDate() !== numeroDia) {
      throw new ErroDataRelativa(`esse dia não existe no mês: "${referencia}"`);
    }
    return paraISO(candidato);
  }

  throw new ErroDataRelativa(`não entendi essa referência de dia: "${referencia}"`);
}
