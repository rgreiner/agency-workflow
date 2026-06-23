// Dados da agência exibidos no cabeçalho/rodapé dos documentos (Orçamento, Autorização
// de Mídia, Pedido de Produção). Hoje fixos da One a One; depois podem ir pra Configurações.

export const AGENCY = {
  nome: 'One a One Comunicação e Estratégia',
  razao: 'Amexcom Publicidade Ltda',
  endereco: 'Rua Voluntários da Pátria, nº 1415, Sl 103 - Centro - Cascavel/PR - CEP: 85812-160',
  cnpjFone: 'CNPJ: 17.531.601/0001-23  Fone: (45) 3225-4443',
  cidade: 'Cascavel/PR',
}

// Observações padrão do rodapé (instruções de NF ao fornecedor/veículo).
export const DOC_NF_NOTES = [
  { text: 'Enviar NF com valor total para o e-mail financeiro@amexcom.com.br', highlight: true },
  { text: 'Enviar NF com prazo mínimo de 30 dias úteis para o vencimento', highlight: false },
  { text: 'Colocar número desta autorização na NF', highlight: true },
]
