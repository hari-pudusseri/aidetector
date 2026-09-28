/** Manual inspection set. Not a validated authorship benchmark. */
export const QUALITY_SET = [
	{
		id: "academic",
		label: "Academic prose",
		text: "The 2019 survey of 412 municipal clerks found turnout rose 3.1 points in precincts that mailed ballots nine days earlier. That gain held after controlling for prior-year turnout and age, though the design cannot separate the mailing date from the reminder postcard that shipped with it.",
	},
	{
		id: "marketing",
		label: "Marketing copy",
		text: "Nestled in the heart of the city, our iconic retreat is a vibrant testament to timeless luxury. It isn't just a stay — it's a feeling. Unlock breathtaking views, savor world-class dining, and embark on a journey that promises memories to last a lifetime.",
	},
	{
		id: "personal",
		label: "Personal narrative",
		text: "I missed the 7:40 again and had to wait with the same two guys who always share a cigarette under the awning. One of them asked about my sister. I said she was fine, which was easier than saying she had moved back in with our parents.",
	},
	{
		id: "esl",
		label: "ESL writing",
		text: "Yesterday I go to the library because my assignment is due Friday. The librarian help me find the book, but the copy is already reserved. I will try again tomorrow after work.",
	},
	{
		id: "templated",
		label: "Templated text",
		text: "Dear {{first_name}}, thank you for contacting support. Your ticket {{ticket_id}} is now in progress. We will update you within 24 hours. If you have more information, reply to this email.",
	},
	{
		id: "generated",
		label: "AI-generated example",
		text: "In today's rapidly evolving landscape, it is important to note that collaboration plays a vital role. By fostering innovation and unlocking potential, organizations can navigate challenges and shape a brighter future. At the end of the day, only time will tell.",
	},
] as const;
