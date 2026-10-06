# Fase

## Skills Claude Code

### `gauntlet-loop`

Skill de [RoboNuggets](https://github.com/robonuggets/gauntlet-loop) installé dans `.claude/skills/gauntlet-loop/`. Il transforme un objectif en un prompt court (~150 mots) qui oblige l'agent à se fixer une référence de qualité réelle, à découper le travail, à faire tourner des paires constructeur / critique sévère, à comparer à l'aveugle avec la référence, et à boucler jusqu'à ce que le résultat gagne.

Utilisation dans Claude Code, depuis ce dépôt :

```
/gauntlet-loop une page de tarifs pour mon SaaS
```

Le skill propose 2 ou 3 références (« bars »), tu en choisis une, et il renvoie un prompt à coller dans une nouvelle session (ou il peut l'exécuter directement).

Technique de [Matt Shumer](https://github.com/mshumer), skill par Jay E (RoboNuggets), sous licence CC BY 4.0 — voir `.claude/skills/gauntlet-loop/NOTICE.md`.
