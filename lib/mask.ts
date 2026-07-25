// Mascara e-mails antes de expor em painéis internos (/analise, /sugestoes)
// -- nunca mostra o endereço completo, só os 2 primeiros caracteres do
// usuário (us**@gmail.com).
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 0) return "**";
  const local = email.slice(0, at);
  return `${local.slice(0, 2)}**${email.slice(at)}`;
}
