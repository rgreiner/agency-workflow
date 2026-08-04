/**
 * Texto do termo de adesão à assinatura eletrônica.
 *
 * Mora aqui, e não no arquivo de actions, porque um módulo `'use server'` só
 * pode exportar funções async: exportar esta string de lá fazia o Next derrubar
 * o módulo inteiro em runtime ("A 'use server' file can only export async
 * functions, found string") — e com ele todas as actions do espelho de ponto.
 *
 * É conteúdo, não segredo: o painel de assinatura mostra o mesmo texto que a
 * action grava, e o hash é calculado sobre esta constante nos dois lados.
 */
export const TERMO_TEXTO = `TERMO DE ADESÃO À ASSINATURA ELETRÔNICA

Declaro estar ciente e de acordo que:

1. Os documentos de registro de jornada (espelho de ponto) me serão apresentados em meio eletrônico, pelo sistema Flow, e serão por mim assinados eletronicamente.

2. Minha assinatura eletrônica é feita mediante autenticação por login e senha pessoais e intransferíveis, cuja guarda e sigilo são de minha responsabilidade exclusiva.

3. Reconheço a validade jurídica dessa forma de assinatura, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001, e do art. 4º, inciso II, da Lei nº 14.063/2020, que trata da assinatura eletrônica avançada.

4. Cada assinatura registra a data e a hora do servidor, o endereço IP, o dispositivo utilizado e um código de verificação (hash) do conteúdo assinado, que permite comprovar que o documento não foi alterado após a assinatura.

5. Ao assinar o espelho de ponto, confirmo que conferi os registros do período e que eles refletem a minha jornada, ressalvadas as divergências que eu venha a apontar antes da assinatura.`
