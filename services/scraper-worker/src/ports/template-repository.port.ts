/** Leitura de `message_templates` — só o corpo, é tudo que o pipeline precisa. */
export interface TemplateRepository {
  getBodyById(templateId: string): Promise<string | null>;
}
