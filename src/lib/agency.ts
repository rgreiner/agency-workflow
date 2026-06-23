// Dados da agência exibidos no cabeçalho/rodapé dos documentos (Orçamento, Autorização
// de Mídia, Pedido de Produção). Hoje fixos da One a One; depois podem ir pra Configurações.

export const AGENCY = {
  nome: 'One a One Comunicação e Estratégia',
  razao: 'Amexcom Publicidade Ltda',
  endereco: 'Rua Voluntários da Pátria, nº 1415, Sl 103 - Centro - Cascavel/PR - CEP: 85812-160',
  cnpjFone: 'CNPJ: 17.531.601/0001-23  Fone: (45) 3225-4443',
  cidade: 'Cascavel/PR',
}

// Texto legal padrão da PRODUÇÃO (Pedido de Produção, Orçamento) — instruções de NF.
export const DOC_NF_NOTES = [
  { text: 'Enviar NF com valor total para o e-mail financeiro@oneaone.com.br', highlight: true },
  { text: 'Enviar NF com prazo mínimo de 30 dias úteis para o vencimento', highlight: false },
  { text: 'Colocar número desta autorização na NF', highlight: true },
]

// Texto legal padrão da MÍDIA (autorizações). Renderizado sob "Observações sobre faturamento".
export const DOC_MIDIA_NOTES = [
  { text: 'O faturamento deve obrigatoriamente seguir as informações fiéis desta autorização;', highlight: false },
  { text: 'Enviar NF com valor total para o e-mail financeiro@oneaone.com.br (o faturamento só é pago mediante envio para este e-mail, caso contrário o pagamento não será efetuado);', highlight: true },
  { text: 'Colocar número desta autorização na NF na descrição do serviço/produto;', highlight: false },
  { text: 'Enviar NF com prazo mínimo de 30 dias úteis para o vencimento.', highlight: false },
]
