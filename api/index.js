export default async function handler(req, res) {
  try {
    const mod = await import('../dist/vercel.js');
    return await mod.default(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        {
          error: 'VERCEL_ENTRYPOINT_IMPORT_ERROR',
          message: err?.message || 'Failed to import dist/vercel.js',
          stack: err?.stack,
        },
        null,
        2
      )
    );
  }
}
