export async function sendWeChatAutomatedChecksWebhook(
  prTitle: string,
  prAuthor: string,
  repoFullName: string,
  prUrl: string,
  checksMarkdown: string,
): Promise<unknown | void> {
  const webhookUrl =
    'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=98fcafb1-db70-4731-94ff-823666993b9c';

  const content = `**Automated PR checks**\n\n**${prTitle}**\n\nAuthor: ${prAuthor}\nRepo: ${repoFullName}\n\nPR URL: ${prUrl}\n\n---\n\n${checksMarkdown}`;

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          content,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Failed to send WeChat checks webhook: ${res.status} ${res.statusText} - ${body}`,
      );
    }

    const data = await res.json();
    console.log('Successfully sent WeChat automated checks webhook');
    return data;
  } catch (error) {
    console.error('Failed to send WeChat automated checks webhook:', (error as Error).message);
  }
}

export async function sendWeChatWebhook(
  prTitle: string,
  prAuthor: string,
  repoFullName: string,
  prUrl: string,
  bugContent: string,
): Promise<unknown> {
  const webhookUrl =
    'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=84df2ed2-887c-4599-83db-86e296e1233f';

  const content = `**${prTitle}**\n\nAuthor: ${prAuthor}\nRepo: ${repoFullName}\n\nPR URL: ${prUrl}\n\n---\n\n${bugContent}`;

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          content: content,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to send WeChat webhook: ${res.status} ${res.statusText} - ${body}`);
    }

    const data = await res.json();
    console.log(`Successfully sent WeChat webhook notification`);
    return data;
  } catch (error) {
    console.error('Failed to send WeChat webhook:', (error as Error).message);
  }
}
