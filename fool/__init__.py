"""The Fool — upstream'in bilmediği, çakışmasız uzantı katmanı.

Bu paketteki hiçbir dosya ``NousResearch/hermes-agent`` içinde bulunmaz.
``git merge upstream/main`` bu dizine asla dokunamaz.

Alt modüller
------------
``branding``
    Marka kimliğinin tek kaynağı + metin dönüştürücü.
``skins/``
    ``the-fool.yaml`` — CLI, TUI ve masaüstü GUI'yi aynı anda temalayan skin.
``config/``
    Yerel model (LM Studio) varsayılanları.

@see docs/fool/ARCHITECTURE.md
@see docs/fool/SEAMS.md
"""

from fool import branding

__all__ = ["branding"]
