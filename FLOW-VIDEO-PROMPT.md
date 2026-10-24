# Fleet OTG explainer video: prompts for Google Flow

Flow makes short clips (about 8 seconds each), so a full explainer is a sequence of scenes you generate one by one and join in Flow's Scenebuilder or any editor.

Two cautions:
- AI video renders text badly. Do not ask it to show the logo or app screens. Add the Fleet OTG logo (`public/fleetotg-logo.png`), titles and real screenshots of the app in your editor afterwards. Scenes 3, 7, 9 and 10 are made for that.
- Paste the style block at the start of every scene. That keeps the look consistent from clip to clip.

## 1. Style block (paste at the start of every scene)

```
Cinematic documentary style, warm natural light, 35mm lens, shallow depth of field, steady handheld camera. Setting: an everyday vehicle fleet company in South Asia: pickup trucks and delivery vans, a busy workshop yard, a modest fleet office. Colour palette: deep navy, warm gold accents, soft daylight. Realistic people, natural expressions, no text, no logos, no subtitles, no watermarks. Calm, confident, professional mood. Native audio: ambient sound only, no music, no speech unless stated.
```

## 2. Voiceover script (record or generate separately, about 75 seconds)

1. "Running a fleet should not mean running after people."
2. "Repairs tracked in spreadsheets. Approvals agreed on a phone call. Nobody sure what a vehicle has really cost, or why the same truck keeps breaking."
3. "Fleet OTG puts every repair on one job card."
4. "Someone asks. A manager approves. The workshop quotes. Everything is recorded: who, when and how much."
5. "Drivers send their odometer reading from a phone link. No app, no password."
6. "Registration, fitness and insurance dates are watched for you, so nothing lapses by surprise."
7. "Costs land on the right vehicle and the right person. Repeat repairs show up, so you can see what keeps failing, and why."
8. "Your data stays yours, and you can export it any time."
9. "One plan, everything included, priced about the same as one month's wage of an unskilled labourer. Try it free."

## 3. Scene prompts (generate each as its own clip)

### Scene 1: The chaos (hook)
```
[Style block] A tired fleet supervisor in a cramped office, surrounded by printed spreadsheets and sticky notes, phone pressed to one ear while another phone rings on the desk. Through the window, a van waits idle in the yard. Quick, slightly frantic pacing, close-up on the papers and the supervisor's stressed face.
```

### Scene 2: Nobody knows
```
[Style block] The same supervisor and a manager stand in the yard looking at a broken-down pickup truck with the bonnet open. They shrug and point at a clipboard, clearly unsure how much previous repairs cost or why it keeps failing. Overcast light, a slightly cooler tone.
```

### Scene 3: One job card (turning point)
```
[Style block] The mood lifts to bright morning light. A driver photographs his vehicle's dashboard with his phone, then taps the screen. Cut to the manager at a desk with a laptop, calmly approving a request, a small smile. Smooth slow push-in on the laptop screen, which shows a clean, unreadable blurred web page.
```

### Scene 4: The workshop
```
[Style block] A mechanic in a clean workshop bay, with a car lifted, looks at a tablet and nods. Beside him a second person checks paperwork on a clipboard against the screen. Warm light, tools in sharp background focus, a feeling of order and trust.
```

### Scene 5: The driver's link
```
[Style block] A delivery driver sits in his van at sunrise, reads the odometer, then types a number into his phone. A brief close-up of his thumb pressing send. He puts the phone away, relieved, and drives off down a tree-lined road.
```

### Scene 6: Nothing expires
```
[Style block] A tidy desk with a vehicle registration card, an insurance paper and a calendar. A hand circles a date on the calendar, and a warm lamp glows. The office manager looks up, satisfied, as a van leaves the gate in the background.
```

### Scene 7: Seeing the cost (bridge scene, add screenshots in your editor)
```
[Style block] The owner of the company sits with a coffee at a clean desk and studies a laptop with a thoughtful, pleased expression. Camera gently orbits. Leave the laptop screen glowing and plain so real dashboard screenshots can be laid over it in editing.
```

### Scene 8: Your data stays yours
```
[Style block] A locked cabinet in a quiet office and an owner placing a folder inside it, then removing a copy to take home. Calm, protective mood. Slow close-up of the key turning.
```

### Scene 9: Everyone on one page
```
[Style block] Wide shot: a driver, a manager, a mechanic and an office accountant, each in their own space, all glancing at their own screens and phones at once, in a clear pattern of coordinated calm. Slow aerial pull-back from the yard to the building.
```

### Scene 10: Close (add the logo and offer in editing)
```
[Style block] A fleet of clean vans lined up in the early morning, doors opening as drivers arrive. Warm gold sunrise flare over the roofline, slow cinematic crane shot rising. End on a calm empty frame at the bottom third where the logo and call to action can be added.
```

## 4. Editing checklist

- Place the logo (`public/fleetotg-logo.png`) on a navy background in scene 10.
- Add on-screen text (the pain points and "Start your free trial") as titles, not in the prompts.
- Overlay real screenshots on scenes 3, 7 and 9: job card, dashboard, vehicles list.
- Add the voiceover and one quiet music bed under it.
- Keep it under about 90 seconds.
