/**
 * O lembrete da manhã (E48 PR 2): a hora de fábrica das contas novas. Vai no código, ao criar a preferência (`aceitarTermos`, o primeiro lugar em que a
 * linha nasce), e não no `default` da coluna: `ALTER COLUMN ... SET DEFAULT` é alteração de coluna e sai da regra 14 (só `ADD COLUMN` e `CREATE TABLE`).
 * Quem já escolheu uma hora mantém a dele; a coluna continua com o `default` antigo ("08:00") para qualquer linha criada fora do código.
 */
export const HORA_LEMBRETE_PADRAO = "09:00";
