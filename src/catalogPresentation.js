import { displayNodeName } from './i18n';

export function displayCatalogNodeName(node, language) {
  return language === 'zh-CN' && node?.catalog_record_label_cn || displayNodeName(language, node?.name || '');
}

export function displayFieldName(field, language) {
  const path = field.catalog_path || field.path || field.name;
  if (language !== 'zh-CN') return path;
  return field.catalog_label_cn || field.label_cn || field.catalog_display_label_cn ||
    field.display_label_cn || path.replaceAll('_', ' ');
}

export function catalogFieldCopy(field, language) {
  const zh = language === 'zh-CN';
  const name = displayFieldName(field, language);
  const example = zh ? field.presentation?.example : field.presentation?.example_en || field.presentation?.example;
  const valueLabel = zh ? field.presentation?.label_zh : field.presentation?.label_en;
  const explanation = zh ? field.presentation?.explanation_zh : field.presentation?.explanation_en;
  const purpose = zh ? field.presentation?.purpose_zh : field.presentation?.explanation_en;
  const useCase = zh ? field.presentation?.use_case_zh : '';
  const role = zh ? field.presentation?.role_zh : '';
  return { name, valueLabel: valueLabel || (zh ? '示例' : 'Example'),
    example: example ?? (zh ? '无安全示例' : 'No safe example'),
    explanation: explanation || field.selectable_reason || (zh ? '字段含义待审阅。' : 'Field meaning needs review.'),
    purpose: purpose || explanation || '', useCase, role };
}
