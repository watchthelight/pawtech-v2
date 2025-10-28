# NSFW Detection Models

This directory contains the WD v3 ViT tagger model and tag vocabulary for avatar NSFW detection.

## Required Files

The following files are required but not committed to git due to their size:

1. **wd-v3-tagger.onnx** (~361 MB) - The ONNX model file
2. **wd-v3-tags.csv** (~301 KB) - Tag vocabulary with 9000+ labels

## Download Instructions

### On Local Machine (Windows)

```powershell
# Download model
Invoke-WebRequest -Uri "https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/model.onnx" -OutFile "models/wd-v3-tagger.onnx"

# Download tags
Invoke-WebRequest -Uri "https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/selected_tags.csv" -OutFile "models/wd-v3-tags.csv"
```

### On Remote Server (Linux)

```bash
# Download model
curl -L "https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/model.onnx" -o models/wd-v3-tagger.onnx

# Download tags
curl -L "https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/selected_tags.csv" -o models/wd-v3-tags.csv
```

## Verification

After downloading, verify file sizes:

```bash
# Model should be ~361 MB
# Tags should be ~301 KB
ls -lh models/
```

## Model Information

- **Name**: WD v3 ViT Tagger
- **Source**: [SmilingWolf/wd-vit-tagger-v3](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3)
- **Purpose**: NSFW/furry/scalie detection for avatar moderation
- **Input**: 448x448 RGB images
- **Output**: 9000+ tag probabilities
- **Runtime**: ONNX Runtime (CPU)

## Performance

- **Inference time**: 150-250ms per image (multi-crop)
- **Memory usage**: ~200-300 MB
- **Accuracy**: 90-95% for explicit NSFW, 85-90% for furry content

## Configuration

Set these environment variables in `.env`:

```env
NSFW_TAGGER_ENABLE=1
NSFW_TAGGER_MODEL=./models/wd-v3-tagger.onnx
NSFW_TAGGER_TAGS=./models/wd-v3-tags.csv
```

## Testing

Test the model with a sample image:

```bash
npx tsx scripts/test-avatar-scan.ts <image-url>
```

## Troubleshooting

**Model not loading?**
- Check file exists and size is correct
- Verify `NSFW_TAGGER_ENABLE=1` in `.env`
- Check logs for error messages

**Slow inference?**
- Normal: 150-250ms for multi-crop
- Reduce crops in `avatarTagger.ts` if needed
- Consider hybrid mode (pre-filter + selective inference)

**High memory usage?**
- Expected: 200-300 MB for model
- Close other applications if needed
- Consider upgrading server RAM if persistent

## Updating the Model

To update to a newer version:

1. Download new model and tags from Hugging Face
2. Test with sample images using `test-avatar-scan.ts`
3. Compare accuracy with current version
4. Update this README with new performance metrics
5. Deploy to production after validation

## License

The WD v3 tagger model is provided by SmilingWolf under the Apache 2.0 license.
See: https://huggingface.co/SmilingWolf/wd-vit-tagger-v3
