# The Last Car Down

**An animated short film where the characters write their own story.**

Four strangers ride the cable car up Table Mountain in Cape Town, South Africa. The wind comes up, they board the last car down, and halfway down the cliff it stalls, swinging in the dark over a 400-metre drop. What happens next is decided by AI agents playing each character. Nobody wrote the script, the dialogue or the ending.

🎬 **Watch the film:** _[add your YouTube or Vimeo link here]_

Started at the Multiplayer AI Hackathon (Thanksgiving Special, Crewbase Collective, San Francisco, November 2026), Track 1: Agent Animated Film, and finished afterwards as a family project.

## The cast

| Character | Who they are | What they bring |
|---|---|---|
| The scholar | 28, from Atlanta, five PhDs | Reads the wind, reasons through machinery, treats a medical emergency. Terrified of heights. |
| Mr. Lucky | 68, from Cape Verde, completely broke | Calm when everyone panics, makes people laugh, and luck breaks his way, sometimes absurdly. |
| The mechanic | 38, from the Bronx | Can fix any engine, boat or plane. Cocky, needs to be in charge. |
| The mom | 35, from Boston, with her two kids | Former all-state volleyball player and hotel worker. Unstoppable when her kids are at stake. |

The characters choose their own names at the start of every run, so each film has a different cast list.

## How it works

The author sets the world, the characters, the catalyst (the car stalls) and the physical rules. The agents decide everything else.

1. **Writers' room.** The agents play four scenes: the ride up, the last car down, the stall, and the aftermath. They speak one at a time, each hearing the full conversation so far, and whoever is addressed answers next. In the stall they choose what to work on (the roof hatch, the backup motor, a signal for help, or the boy's asthma attack), and the outcome depends on who tries what and how well suited they are. A showrunner keeps the scenes coherent but never decides outcomes.
2. **Director.** Turns the screenplay into a shot list, keeping every line word for word, and guarantees a proper ending: how they got down, closing lines, and an end card.
3. **Production.** Each shot gets a keyframe painted with the character portraits as references, so faces stay consistent, then is animated with lip-synced dialogue, ambient sound and music.
4. **Edit.** The clips are joined into one film with subtitles.

There are three possible endings, earned by the agents' choices: **Down Together** (they restart the motor themselves), **The Long Night** (their signal brings mountain rescue), or **Dawn on the Wire** (stranded until morning). Run it twice and you get two different films.

## Built with

- **OpenAI** for the agents' brains: the characters, the showrunner and the director
- **Runware**: character portraits and scenery, Qwen Image 3.0 for keyframes, FLUX 3 Video for animation with speech and sound
- **ffmpeg** for the final edit
- **Node.js**, with no framework
- **Bruin** for analysing agent decisions across runs (from the hackathon version)

## Making of

The finished film's screenplay, shot list, subtitles and keyframes are in [`making-of/dawn-on-the-wire/`](making-of/dawn-on-the-wire/). Read `screenplay.md` to see every line the characters wrote, with each character's private reasoning.

The film ran to 26 shots, about 3 minutes, and cost about $34 in Runware credits.

## Run it yourself

```bash
npm install
cp .env.example .env     # add OPENAI_API_KEY, OPENAI_MODEL, RUNWARE_API_KEY and BRAIN=openai
npm run portraits        # generate the character portraits
npm run scenes           # generate the scenery
npm run film:story       # write a new story (free, about two minutes)
npm run film -- --from assets/films/<folder it prints>   # shoot it
```

Other commands:
- `npm run film` writes and shoots a brand-new film in one go.
- `npm run film:extend -- --from <folder>` adds the ending shots to an existing film.
- `npm start`, then open `localhost:3000`, shows the live simulation of the agents deciding in real time.

Add `--mock` to any film command to test the whole pipeline offline without spending anything.
