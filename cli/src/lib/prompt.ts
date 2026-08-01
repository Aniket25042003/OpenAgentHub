import { createInterface } from "node:readline";

export async function confirm(question: string, defaultAnswer = false): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultAnswer ? " (Y/n)" : " (y/N)";
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${question}${suffix} `, resolve);
    });
    const a = answer.trim().toLowerCase();
    if (a === "") return defaultAnswer;
    return a === "y" || a === "yes";
  } finally {
    rl.close();
  }
}

export async function confirmAll(questions: string[], forceYes: boolean): Promise<boolean[]> {
  if (forceYes) return questions.map(() => true);
  const answers: boolean[] = [];
  for (const q of questions) answers.push(await confirm(q));
  return answers;
}
