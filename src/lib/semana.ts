/**
 * Segunda-feira ISO da semana que contem a data (etapa 9, decisao 2 do
 * `PROXIMO.md`: `modelos_nicho.semana`). Calculada na data local do Brasil
 * (mesmo raciocinio de `hojeISO` em `config.ts`: o servidor pode estar em
 * UTC), devolvida como "AAAA-MM-DD".
 */
export function segundaFeiraIso(data = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const partes = fmt.formatToParts(data);
  const ano = Number(partes.find((p) => p.type === "year")?.value);
  const mes = Number(partes.find((p) => p.type === "month")?.value);
  const dia = Number(partes.find((p) => p.type === "day")?.value);

  const dataLocal = new Date(Date.UTC(ano, mes - 1, dia));
  const diaDaSemana = dataLocal.getUTCDay();
  const deslocamento = diaDaSemana === 0 ? -6 : 1 - diaDaSemana;
  dataLocal.setUTCDate(dataLocal.getUTCDate() + deslocamento);

  return dataLocal.toISOString().slice(0, 10);
}
