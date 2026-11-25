// Dati di esempio precaricati al primo avvio (R25, decisione: flag "example", eliminabili).
// Fonte: "E Obiettivi I trimestre.doc" (refusi corretti: "placare" -> "placcare").
import { newExercise, newPlan, newPlanSession, newBlock, findExerciseByName, SEED_TIME } from './model.js';

export const SEED_GAMES = [
  'Staffetta con meta', 'Gioco dei nomi', 'Fulmine', 'Palla quadrata', 'Passaggio della palla in fila indiana seduti',
  'Staffetta', 'Mastino', 'Mastino con placcaggio', 'Lupo ci sei', 'Fazzoletto con meta', 'Fazzoletto con meta e placcaggio',
  'Tana dell\'orso', 'Scalpo', 'Scalpo a rincorrersi', 'Agnello e lupo', 'Circuito',
];

// Struttura delle 8 sedute: R = riscaldamento [sotto-voci], G = gioco, S = spiegazione, P = partita
const SESSIONS = [
  { first: true, warm: ['Staffetta con meta', 'Gioco dei nomi'], games: ['Fulmine', 'Palla quadrata'], explain: true },
  { warm: ['passaggio della palla in fila indiana seduti', 'staffetta'], games: ['Mastino', 'Lupo ci sei'] },
  { warm: ['passaggio della palla', 'staffetta'], games: ['Fulmine', 'Mastino con placcaggio'] },
  { warm: ['passaggio della palla', 'staffetta'], games: ['Fazzoletto con meta e placcaggio', 'Tana dell\'orso'] },
  { warm: ['passaggio della palla', 'staffetta'], games: ['Scalpo', 'Palla quadrata'] },
  { warm: ['passaggio della palla', 'staffetta'], games: ['Mastino con placcaggio', 'Agnello e lupo'] },
  { warm: ['passaggio della palla', 'staffetta'], games: ['Circuito', 'Scalpo a rincorrersi'] },
  { warm: ['passaggio della palla', 'staffetta'], games: ['Fazzoletto con meta', 'Fulmine'] },
];

export function slug(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Id e date STABILI: lo stesso esempio ha lo stesso id su ogni dispositivo, così su Drive non si duplica
// e qualunque modifica reale (più recente di SEED_TIME) vince al ripristino.
export function buildSeed() {
  const fixed = { example: true, createdAt: SEED_TIME, updatedAt: SEED_TIME };
  const exercises = SEED_GAMES.map((name) => newExercise({
    ...fixed, id: 'seed-ex-' + slug(name), name, categories: ['U6', 'U8'],
    description: '', objectives: '',
  }));
  const plan = newPlan({
    ...fixed, id: 'seed-plan-trimestre-1', season: '',
    title: 'I° TRIMESTRE', term: 1, category: '',
    educationalGoals: 'Socializzare e vincere la paura del contatto, del suolo e favorire l’iniziativa individuale.',
    didacticGoals: 'Segnare la meta, annullare, placcare, tenuto, passaggio in avanti fuori gioco.',
  });
  let n = 0;
  const bid = () => 'seed-b' + (++n);
  plan.sessions = SESSIONS.map((s, si) => {
    const blocks = [];
    if (!s.first) blocks.push(newBlock('CHIACCHIERATA_INIZIALE'));
    blocks.push(newBlock('RISCALDAMENTO', { subItems: [...s.warm] }));
    for (const g of s.games) {
      blocks.push(newBlock('PAUSA'));
      const ex = findExerciseByName(exercises, g);
      blocks.push(newBlock('GIOCO', { title: g, exerciseId: ex ? ex.id : null }));
    }
    blocks.push(newBlock('PAUSA'));
    if (s.explain) blocks.push(newBlock('SPIEGAZIONE'));
    blocks.push(newBlock('PARTITA'));
    if (!s.first) blocks.push(newBlock('CHIACCHIERATA_FINALE'));
    for (const b of blocks) b.id = bid();
    return newPlanSession({ id: 'seed-s' + (si + 1), blocks });
  });
  return { exercises, plans: [plan] };
}
