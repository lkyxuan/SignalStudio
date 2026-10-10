import React, { useContext } from 'react';
import { CardDetailContext } from './CardDetailContext';
import { cardExplanation, detailKind } from './cardDetailModel';

export function ProcessingCardFrame({ node, graph, openNode, language, children, algorithm: explicitAlgorithm = '' }) {
  const managed = useContext(CardDetailContext);
  if (managed) return <>{children}</>;
  const zh = language === 'zh-CN';
  const algorithm = explicitAlgorithm || cardExplanation(node, language);
  return <div className="processing-card-frame">
    {children}
    <section className="processing-goal-readonly execution-trigger processing-algorithm">
      <h3>{zh ? detailKind(node) === 'decision' ? '判断规则' : '怎么处理' : detailKind(node) === 'decision' ? 'Decision rule' : 'How it works'}</h3>
      <p>{algorithm || (zh ? '这一步尚未定义规则，暂时无法给出可验证的推导。' : 'No rule is defined yet; a verifiable derivation is unavailable.')}</p>
    </section>
  </div>;
}
